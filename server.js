import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { buildInfo } from "./build-info.js";
import { readFreshCache, writeBoundedCache } from "./domain/bounded-cache.js";
import { inGeoBoundary, mergeStations, summarizeStations } from "./domain/stations.js";
import { clearAlfaCache, fetchAlfa } from "./providers/alfa.js";
import { clearBenzupCache, fetchBenzup, normalizeBenzupStation } from "./providers/benzup.js";
import { clearGdebenzCache, fetchGdebenz } from "./providers/gdebenz.js";
import { clearMultigoCache, fetchMultigo } from "./providers/multigo.js";
import { fetchSber, normalizeSberStation } from "./providers/sber.js";
import { SberBrowserWorker } from "./providers/sber-browser.js";
import { fetchTbank } from "./providers/tbank.js";
import { clearYandexCache, enrichYandexPrices, isYandexVerificationCandidate, parseYandexFuelPrices } from "./providers/yandex.js";
import { clearGeocoderCache, geocodeLocation } from "./services/geocoder.js";
import { createBenzTelegramHandler, TELEGRAM_BOT_PROFILE } from "./services/telegram-bot.js";
import { TelegramPollingGateway } from "./services/telegram-gateway.js";
import { AnalyticsService } from "./services/analytics.js";

export { mergeStations, normalizeBenzupStation, normalizeSberStation, isYandexVerificationCandidate, parseYandexFuelPrices };
export { normalizeFuelName } from "./domain/stations.js";

const PUBLIC_DIR = join(process.cwd(), "public");
const resultCache = new Map();
const viewportStreamCache = new Map();
const sberWorker = new SberBrowserWorker(config.sber);
const requestBuckets = new Map();
const securityHeaders = Object.freeze({
  "Content-Security-Policy": "default-src 'self'; script-src 'self' https://unpkg.com; style-src 'self' 'unsafe-inline' https://unpkg.com; img-src 'self' data: https://unpkg.com https://*.tile.openstreetmap.org; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
  "Permissions-Policy": "geolocation=(self)",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
});

function cookieValue(req, name) {
  const match = String(req.headers.cookie || "").split(";").map((value) => value.trim()).find((value) => value.startsWith(`${name}=`));
  if (!match) return null;
  try {
    return decodeURIComponent(match.slice(name.length + 1));
  } catch {
    return null;
  }
}

function webVisitor(req) {
  return cookieValue(req, "benz_vid") || `${req.socket.remoteAddress || "unknown"}|${req.headers["user-agent"] || "unknown"}`;
}

function bearerToken(req) {
  const match = String(req.headers.authorization || "").match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || "";
}

function json(res, status, body) {
  res.writeHead(status, { ...securityHeaders, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

function asNumber(value, key) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Параметр ${key} должен быть числом`);
  return number;
}

export function readBbox(params) {
  const keys = ["minLat", "maxLat", "minLon", "maxLon"];
  for (const key of keys) if (!params.has(key) || !String(params.get(key)).trim()) throw new Error(`Параметр ${key} обязателен`);
  const bbox = Object.fromEntries(keys.map((key) => [key, asNumber(params.get(key), key)]));
  if (bbox.minLat < -90 || bbox.maxLat > 90 || bbox.minLon < -180 || bbox.maxLon > 180) {
    throw new Error("Координаты карты выходят за допустимый диапазон");
  }
  if (bbox.minLat >= bbox.maxLat || bbox.minLon >= bbox.maxLon) throw new Error("Некорректные границы карты");
  if (bbox.maxLat - bbox.minLat > 12 || bbox.maxLon - bbox.minLon > 12) {
    throw new Error("Слишком большая область карты. Приблизьте карту для загрузки АЗС");
  }
  return bbox;
}

function fulfilled(result) {
  return result.status === "fulfilled" ? result.value : null;
}

export function withTimeout(promise, timeoutMs, label, onTimeout = () => {}) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      onTimeout();
      reject(new Error(`${label}: превышено время ожидания ${Math.ceil(timeoutMs / 1000)} с`));
    }, timeoutMs);
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function boundedProviderCall(factory, label = "ожидание данных", externalSignal = null) {
  const controller = new AbortController();
  const abort = () => controller.abort(externalSignal?.reason || new Error(`${label}: клиент отключился`));
  if (externalSignal?.aborted) abort();
  else externalSignal?.addEventListener("abort", abort, { once: true });
  return withTimeout(factory(controller.signal), config.viewportProviderTimeoutMs, label, () => {
    controller.abort(new Error(`${label}: запрос отменён`));
  }).finally(() => externalSignal?.removeEventListener("abort", abort));
}

function allowRequest(req, bucketName, limit) {
  const now = Date.now();
  const key = `${bucketName}:${req.socket.remoteAddress || "unknown"}`;
  const current = requestBuckets.get(key);
  const bucket = !current || now - current.startedAt >= config.requestRateLimit.windowMs
    ? { startedAt: now, count: 0 }
    : current;
  bucket.count += 1;
  requestBuckets.delete(key);
  requestBuckets.set(key, bucket);
  while (requestBuckets.size > config.requestRateLimit.maxClients) requestBuckets.delete(requestBuckets.keys().next().value);
  return bucket.count <= limit;
}

export function providerFailureMessage(result, source) {
  if (result.status !== "rejected") return null;
  const detail = String(result.reason?.message || "").trim();
  if (!detail) return `${source}: источник временно недоступен.`;
  if (/failed to fetch|fetch failed|network|econn|enotfound|etimedout/i.test(detail)) {
    return `${source}: не удалось подключиться к источнику.`;
  }
  return `${source}: ${detail}`;
}

export function alfaProviderCall(bbox, fetchImpl = fetchAlfa, enabled = config.alfa.enabled) {
  return enabled ? fetchImpl(bbox) : Promise.resolve(null);
}

async function searchStations(bbox, { mode = "full" } = {}) {
  const viewport = mode === "viewport";
  const key = `${mode}:${JSON.stringify(bbox)}`;
  const saved = readFreshCache(resultCache, key, config.resultCacheTtlMs);
  if (saved) return { ...saved, cached: true };

  const providerFactories = [
    (signal) => fetchTbank(bbox, { signal }),
    () => alfaProviderCall(bbox),
    () => fetchSber(sberWorker, bbox),
    (signal) => fetchBenzup(bbox, { signal }),
    (signal) => fetchGdebenz(bbox, { signal }),
    (signal) => fetchMultigo(bbox, { signal }),
  ];
  const providerPromises = providerFactories.map((factory) => viewport ? boundedProviderCall(factory) : factory());
  const [tbankResult, alfaResult, sberResult, benzupResult, gdebenzResult, multigoResult] = await Promise.allSettled(providerPromises);
  const tbank = fulfilled(tbankResult);
  const alfa = fulfilled(alfaResult);
  const sber = fulfilled(sberResult);
  const benzup = fulfilled(benzupResult);
  const gdebenz = fulfilled(gdebenzResult);
  const multigo = fulfilled(multigoResult);
  const warnings = [];
  const stations = [];

  if (tbank) {
    stations.push(...tbank.stations);
    if (tbank.truncated) warnings.push("Область очень велика: достигнут лимит запросов T-Bank, сводка может быть неполной.");
  } else warnings.push(providerFailureMessage(tbankResult, "T-Bank"));

  if (alfa) stations.push(...alfa.stations);
  else warnings.push(providerFailureMessage(alfaResult, "Alfa AZS"));

  if (sber) {
    stations.push(...sber.stations);
    if (sber.warning) warnings.push(sber.warning);
  } else warnings.push(providerFailureMessage(sberResult, "Sber AZS"));

  if (benzup) {
    stations.push(...benzup.stations);
    if (benzup.configured && benzup.warning) warnings.push(benzup.warning);
  } else warnings.push(providerFailureMessage(benzupResult, "BenzUp"));

  if (gdebenz) stations.push(...gdebenz.stations);
  else warnings.push(providerFailureMessage(gdebenzResult, "ГдеБЕНЗ"));
  if (gdebenz?.truncated) warnings.push("ГдеБЕНЗ покрывает только радиус 30 км от центра: данные для большой территории неполные.");

  if (multigo) stations.push(...multigo.stations);
  else warnings.push(providerFailureMessage(multigoResult, "Multigo"));
  if (multigo?.truncated) warnings.push(`Multigo вернул лимит ${multigo.limit} ближайших объектов: данные для области могут быть неполными.`);

  const merged = mergeStations(stations);
  const yandex = viewport
    ? { stations: merged, eligible: merged.filter(isYandexVerificationCandidate).length, attempted: 0, checked: 0, warning: null, skipped: true }
    : await enrichYandexPrices(merged);
  if (config.yandex.enabled && yandex.warning) warnings.push(yandex.warning);

  const value = {
    build: buildInfo,
    stations: yandex.stations,
    warnings: warnings.filter(Boolean),
    sourceRequests: {
      tbank: tbank?.requests || 0,
      alfa: config.alfa.enabled && alfa && !alfa.cached ? 1 : 0,
      sber: sber ? 1 : 0,
      benzup: benzup?.configured && !benzup.cached ? 1 : 0,
      gdebenz: gdebenz && !gdebenz.cached ? 1 : 0,
      multigo: multigo && !multigo.cached ? 1 : 0,
      yandex: yandex.attempted,
    },
    sources: {
      tbank: {
        available: Boolean(tbank),
        configured: true,
        role: "availability",
        returned: tbank?.stations.length || 0,
        error: providerFailureMessage(tbankResult, "T-Bank"),
      },
      alfa: {
        available: Boolean(config.alfa.enabled && alfa?.available),
        configured: config.alfa.enabled,
        role: "availability_and_prices",
        refreshedAt: alfa?.fetchedAt ? new Date(alfa.fetchedAt).toISOString() : null,
        refreshSeconds: config.alfa.enabled ? config.alfa.cacheTtlMs / 1000 : null,
        returned: alfa?.returned || 0,
        included: alfa?.stations.length || 0,
        droppedOutside: alfa?.droppedOutside || 0,
        invalidCoordinates: alfa?.invalidCoordinates || 0,
        error: config.alfa.enabled ? providerFailureMessage(alfaResult, "Alfa AZS") : null,
      },
      sber: {
        available: Boolean(sber?.available),
        configured: true,
        role: "availability",
        refreshedAt: sber?.fetchedAt ? new Date(sber.fetchedAt).toISOString() : null,
        refreshSeconds: config.sber.refreshMs / 1000,
        error: providerFailureMessage(sberResult, "Sber AZS"),
      },
      benzup: {
        available: Boolean(benzup?.available),
        configured: Boolean(benzup?.configured),
        role: "prices",
        returned: benzup?.returned || 0,
        included: benzup?.stations.length || 0,
        invalid: benzup?.invalid || 0,
        error: providerFailureMessage(benzupResult, "BenzUp"),
      },
      yandex: {
        available: config.yandex.enabled && yandex.checked > 0,
        configured: config.yandex.enabled,
        role: "price_verification",
        skipped: Boolean(yandex.skipped),
        eligible: yandex.eligible,
        attempted: yandex.attempted,
        checked: yandex.checked,
      },
      gdebenz: {
        available: Boolean(gdebenz?.available),
        configured: true,
        role: "availability",
        refreshedAt: gdebenz?.updatedAt || null,
        radiusKm: gdebenz?.radiusKm || null,
        returned: gdebenz?.returned || 0,
        included: gdebenz?.stations.length || 0,
        invalid: gdebenz?.invalid || 0,
        droppedOutside: gdebenz?.droppedOutside || 0,
        error: providerFailureMessage(gdebenzResult, "ГдеБЕНЗ"),
      },
      multigo: {
        available: Boolean(multigo?.available),
        configured: true,
        role: "catalog",
        limit: multigo?.limit || null,
        returned: multigo?.returned || 0,
        included: multigo?.stations.length || 0,
        invalid: multigo?.invalid || 0,
        droppedOutside: multigo?.droppedOutside || 0,
        droppedElectric: multigo?.droppedElectric || 0,
        error: providerFailureMessage(multigoResult, "Multigo"),
      },
    },
  };
  if (!value.warnings.length) writeBoundedCache(resultCache, key, value, config.resultCacheMaxEntries);
  return { ...value, cached: false };
}

export async function streamProviderSnapshots(providerCalls, onSnapshot) {
  const normalizedCalls = providerCalls.map((call, index) => call?.promise
    ? { source: call.source || `provider-${index + 1}`, promise: call.promise }
    : { source: `provider-${index + 1}`, promise: call });
  const pending = new Map(normalizedCalls.map((call, index) => [
    index,
    Promise.resolve(call.promise).then(
      (value) => ({ index, source: call.source, value }),
      (error) => ({ index, source: call.source, error }),
    ),
  ]));
  const stations = [];
  const errors = [];
  let completed = 0;

  while (pending.size) {
    const settled = await Promise.race(pending.values());
    pending.delete(settled.index);
    completed += 1;
    if (Array.isArray(settled.value?.stations)) stations.push(...settled.value.stations);
    if (settled.error) errors.push(settled.source);
    await onSnapshot({
      stations: mergeStations(stations),
      completed,
      total: providerCalls.length,
      complete: pending.size === 0,
      failedSources: [...errors],
    });
  }
}

async function streamViewportStations(res, bbox) {
  res.writeHead(200, {
    ...securityHeaders,
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-store",
  });

  const key = JSON.stringify(bbox);
  const saved = readFreshCache(viewportStreamCache, key, config.resultCacheTtlMs);
  if (saved) {
    res.end(`${JSON.stringify({ stations: saved, completed: 1, total: 1, complete: true, cached: true })}\n`);
    return;
  }

  const streamController = new AbortController();
  const abortStream = () => streamController.abort(new Error("Клиент закрыл поток карты"));
  res.once("close", abortStream);
  const providerCalls = [
    ["T-Bank", (signal) => fetchTbank(bbox, { signal })],
    ["Alfa AZS", () => alfaProviderCall(bbox)],
    ["Sber AZS", () => fetchSber(sberWorker, bbox)],
    ["BenzUp", (signal) => fetchBenzup(bbox, { signal })],
    ["ГдеБЕНЗ", (signal) => fetchGdebenz(bbox, { signal })],
    ["Multigo", (signal) => fetchMultigo(bbox, { signal })],
  ].map(([source, factory]) => ({ source, promise: boundedProviderCall(factory, "ожидание данных", streamController.signal) }));
  let finalStations = [];
  let finalFailures = [];
  try {
    await streamProviderSnapshots(providerCalls, (snapshot) => {
      finalStations = snapshot.stations;
      finalFailures = snapshot.failedSources;
      if (!res.destroyed) res.write(`${JSON.stringify(snapshot)}\n`);
    });
  } finally {
    res.off("close", abortStream);
  }
  if (!finalFailures.length) writeBoundedCache(viewportStreamCache, key, finalStations, config.resultCacheMaxEntries);
  if (!res.destroyed) res.end();
}

function clearAllCaches() {
  resultCache.clear();
  viewportStreamCache.clear();
  clearAlfaCache();
  clearBenzupCache();
  clearGeocoderCache();
  clearYandexCache();
  clearGdebenzCache();
  clearMultigoCache();
  sberWorker.invalidateAll();
}

const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };

function validLocationQuery(value) {
  const query = String(value || "").trim();
  if (query.length < 2 || query.length > 100) throw new Error("Введите город или область — от 2 до 100 символов");
  return query;
}

async function summaryFor(query) {
  const location = await geocodeLocation(validLocationQuery(query));
  const result = await searchStations(location.bbox);
  const stations = result.stations.filter((station) => inGeoBoundary(station, location.boundary));
  const { boundary, ...publicLocation } = location;
  return { ...result, stations, location: publicLocation, summary: summarizeStations(stations) };
}

export function startServer(port = config.port, host = config.host) {
  const analytics = new AnalyticsService(config.analytics);
  void analytics.start();
  const botHandler = createBenzTelegramHandler({
    buildInfo,
    findSummary: summaryFor,
    refreshSummary: async (query) => {
      validLocationQuery(query);
      clearAllCaches();
      return summaryFor(query);
    },
  });
  const telegramGateway = new TelegramPollingGateway(async (message) => {
    void analytics.recordTelegram(message);
    return botHandler(message);
  }, { ...config.telegram, ...TELEGRAM_BOT_PROFILE });
  if (config.telegram.enabled && !telegramGateway.isConfigured()) {
    throw new Error("TELEGRAM_POLLING_ENABLED=true requires a valid TELEGRAM_BOT_TOKEN.");
  }
  const server = createServer(async (req, res) => {
    try {
      const requestUrl = new URL(req.url || "/", "http://localhost");
      if (requestUrl.pathname === "/api/summary") {
        if (req.method !== "GET") return json(res, 405, { error: "Используйте GET" });
        if (!allowRequest(req, "read", config.requestRateLimit.readsPerWindow)) return json(res, 429, { error: "Слишком много запросов. Повторите позже" });
        const body = await summaryFor(requestUrl.searchParams.get("q"));
        void analytics.recordWeb("search", webVisitor(req), req.headers["user-agent"]);
        return json(res, 200, body);
      }
      if (requestUrl.pathname === "/api/cache/refresh") {
        if (req.method !== "POST") return json(res, 405, { error: "Используйте POST" });
        if (String(req.headers["sec-fetch-site"] || "").toLowerCase() === "cross-site") return json(res, 403, { error: "Cross-site cache refresh is forbidden" });
        if (!allowRequest(req, "refresh", config.requestRateLimit.refreshesPerWindow)) return json(res, 429, { error: "Кэш можно обновлять не чаще нескольких раз в минуту" });
        const query = validLocationQuery(requestUrl.searchParams.get("q"));
        clearAllCaches();
        const startedAt = Date.now();
        const body = await summaryFor(query);
        void analytics.recordWeb("search", webVisitor(req), req.headers["user-agent"]);
        return json(res, 200, {
          ...body,
          cacheRefresh: { refreshed: true, completedAt: new Date().toISOString(), durationMs: Date.now() - startedAt },
        });
      }
      if (requestUrl.pathname === "/api/stations") {
        if (req.method !== "GET") return json(res, 405, { error: "Используйте GET" });
        if (!allowRequest(req, "read", config.requestRateLimit.readsPerWindow)) return json(res, 429, { error: "Слишком много запросов. Повторите позже" });
        const mode = requestUrl.searchParams.get("mode") === "viewport" ? "viewport" : "full";
        return json(res, 200, await searchStations(readBbox(requestUrl.searchParams), { mode }));
      }
      if (requestUrl.pathname === "/api/stations/stream") {
        if (req.method !== "GET") return json(res, 405, { error: "Используйте GET" });
        if (!allowRequest(req, "read", config.requestRateLimit.readsPerWindow)) return json(res, 429, { error: "Слишком много запросов. Повторите позже" });
        return await streamViewportStations(res, readBbox(requestUrl.searchParams));
      }
      if (requestUrl.pathname === "/api/health") {
        if (req.method !== "GET" && req.method !== "HEAD") return json(res, 405, { error: "Method Not Allowed" });
        return json(res, 200, {
          ok: true,
          build: buildInfo,
          sberWorker: sberWorker.status(),
          telegram: telegramGateway.status(),
          analytics: analytics.status(),
        });
      }
      if (requestUrl.pathname === "/api/admin/stats") {
        if (req.method !== "GET") return json(res, 405, { error: "Method Not Allowed" });
        if (!allowRequest(req, "admin", 30)) return json(res, 429, { error: "Too Many Requests" });
        if (!analytics.isAdminToken(bearerToken(req))) return json(res, 401, { error: "Unauthorized" });
        try {
          return json(res, 200, await analytics.stats());
        } catch {
          return json(res, 503, { error: "Analytics database is unavailable" });
        }
      }

      const requested = requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
      if (req.method !== "GET" && req.method !== "HEAD") return json(res, 405, { error: "Method Not Allowed" });
      const file = normalize(resolve(PUBLIC_DIR, `.${requested}`));
      if (file !== PUBLIC_DIR && !file.startsWith(`${PUBLIC_DIR}${sep}`)) return json(res, 403, { error: "Forbidden" });
      const content = await readFile(file);
      const headers = { ...securityHeaders, "Content-Type": mime[extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" };
      if (requested === "/index.html" && req.method === "GET") {
        let visitorId = cookieValue(req, "benz_vid");
        if (!visitorId) {
          visitorId = randomUUID();
          const secure = req.socket.encrypted || String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() === "https" ? "; Secure" : "";
          headers["Set-Cookie"] = `benz_vid=${encodeURIComponent(visitorId)}; Max-Age=31536000; Path=/; HttpOnly; SameSite=Lax${secure}`;
        }
        void analytics.recordWeb("page_view", visitorId, req.headers["user-agent"]);
      }
      headers["Content-Length"] = String(content.length);
      res.writeHead(200, headers);
      res.end(req.method === "HEAD" ? undefined : content);
    } catch (error) {
      if (error.code === "ENOENT") return json(res, 404, { error: "Не найдено" });
      if (error.code === "GEOCODER_BUSY") return json(res, 503, { error: "Сервис поиска временно перегружен. Повторите позже" });
      const clientError = /^(Введите|Не удалось найти|Параметр |Некорректные границы|Слишком большая область|Координаты карты)/u.test(String(error.message || ""));
      json(res, clientError ? 400 : 500, { error: clientError ? error.message : "Внутренняя ошибка сервера" });
    }
  }).listen(port, host, () => {
    if (config.telegram.enabled) telegramGateway.start();
    const address = server.address();
    console.log(`Benz AI: http://${host}:${typeof address === "object" && address ? address.port : port}`);
  });
  let cleanupPromise = null;
  server.on("close", () => {
    cleanupPromise ||= Promise.allSettled([
      telegramGateway.stop(),
      sberWorker.close(),
      analytics.close(),
    ]);
  });
  server.waitForCleanup = () => cleanupPromise || Promise.resolve();
  return server;
}

if (resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  const server = startServer();
  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    server.close(async () => {
      await server.waitForCleanup();
      process.exit(0);
    });
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
