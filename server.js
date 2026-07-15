import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { buildInfo } from "./build-info.js";
import { readFreshCache, writeBoundedCache } from "./domain/bounded-cache.js";
import { inGeoBoundary, mergeStations, summarizeStations } from "./domain/stations.js";
import { clearAlfaCache, fetchAlfa } from "./providers/alfa.js";
import { fetchBenzup, normalizeBenzupStation } from "./providers/benzup.js";
import { clearGdebenzCache, fetchGdebenz } from "./providers/gdebenz.js";
import { clearMultigoCache, fetchMultigo } from "./providers/multigo.js";
import { fetchSber, normalizeSberStation } from "./providers/sber.js";
import { SberBrowserWorker } from "./providers/sber-browser.js";
import { fetchTbank } from "./providers/tbank.js";
import { clearYandexCache, enrichYandexPrices, isYandexVerificationCandidate, parseYandexFuelPrices } from "./providers/yandex.js";
import { clearGeocoderCache, geocodeLocation } from "./services/geocoder.js";
import { createBenzTelegramHandler, TELEGRAM_BOT_PROFILE } from "./services/telegram-bot.js";
import { TelegramPollingGateway } from "./services/telegram-gateway.js";

export { mergeStations, normalizeBenzupStation, normalizeSberStation, isYandexVerificationCandidate, parseYandexFuelPrices };
export { normalizeFuelName } from "./domain/stations.js";

const PUBLIC_DIR = join(process.cwd(), "public");
const resultCache = new Map();
const sberWorker = new SberBrowserWorker(config.sber);

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

function asNumber(value, key) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Параметр ${key} должен быть числом`);
  return number;
}

function readBbox(params) {
  const keys = ["minLat", "maxLat", "minLon", "maxLon"];
  const bbox = Object.fromEntries(keys.map((key) => [key, asNumber(params.get(key), key)]));
  if (bbox.minLat >= bbox.maxLat || bbox.minLon >= bbox.maxLon) throw new Error("Некорректные границы карты");
  if (bbox.maxLat - bbox.minLat > 12 || bbox.maxLon - bbox.minLon > 12) {
    throw new Error("Слишком большая область карты. Приблизьте карту для загрузки АЗС");
  }
  return bbox;
}

function fulfilled(result) {
  return result.status === "fulfilled" ? result.value : null;
}

export function withTimeout(promise, timeoutMs, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}: превышено время ожидания ${Math.ceil(timeoutMs / 1000)} с`)), timeoutMs);
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
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

async function searchStations(bbox, { mode = "full" } = {}) {
  const viewport = mode === "viewport";
  const key = `${mode}:${JSON.stringify(bbox)}`;
  const saved = readFreshCache(resultCache, key, config.resultCacheTtlMs);
  if (saved) return { ...saved, cached: true };

  const providerCalls = [
    fetchTbank(bbox),
    fetchAlfa(bbox),
    fetchSber(sberWorker, bbox),
    fetchBenzup(bbox),
    fetchGdebenz(bbox),
    fetchMultigo(bbox),
  ];
  const providerPromises = viewport
    ? providerCalls.map((call) => withTimeout(call, config.viewportProviderTimeoutMs, "ожидание данных"))
    : providerCalls;
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

  if (multigo) stations.push(...multigo.stations);
  else warnings.push(providerFailureMessage(multigoResult, "Multigo"));

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
      alfa: alfa?.cached ? 0 : 1,
      sber: sber ? 1 : 0,
      benzup: benzup?.configured ? 1 : 0,
      gdebenz: gdebenz ? 1 : 0,
      multigo: multigo ? 1 : 0,
      yandex: yandex.attempted,
    },
    sources: {
      tbank: {
        available: Boolean(tbank),
        configured: true,
        role: "availability",
        error: providerFailureMessage(tbankResult, "T-Bank"),
      },
      alfa: {
        available: Boolean(alfa?.available),
        configured: true,
        role: "availability_and_prices",
        refreshedAt: alfa?.fetchedAt ? new Date(alfa.fetchedAt).toISOString() : null,
        refreshSeconds: config.alfa.cacheTtlMs / 1000,
        returned: alfa?.returned || 0,
        included: alfa?.stations.length || 0,
        droppedOutside: alfa?.droppedOutside || 0,
        invalidCoordinates: alfa?.invalidCoordinates || 0,
        error: providerFailureMessage(alfaResult, "Alfa AZS"),
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
        droppedOutside: multigo?.droppedOutside || 0,
        droppedElectric: multigo?.droppedElectric || 0,
        error: providerFailureMessage(multigoResult, "Multigo"),
      },
    },
  };
  writeBoundedCache(resultCache, key, value, config.resultCacheMaxEntries);
  return { ...value, cached: false };
}

function clearAllCaches() {
  resultCache.clear();
  clearAlfaCache();
  clearGeocoderCache();
  clearYandexCache();
  clearGdebenzCache();
  clearMultigoCache();
  sberWorker.invalidateAll();
}

const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };

async function summaryFor(query) {
  const location = await geocodeLocation(query);
  const result = await searchStations(location.bbox);
  const stations = result.stations.filter((station) => inGeoBoundary(station, location.boundary));
  const { boundary, ...publicLocation } = location;
  return { ...result, stations, location: publicLocation, summary: summarizeStations(stations) };
}

export function startServer(port = config.port, host = config.host) {
  const telegramGateway = new TelegramPollingGateway(createBenzTelegramHandler({
    buildInfo,
    findSummary: summaryFor,
    refreshSummary: async (query) => {
      clearAllCaches();
      return summaryFor(query);
    },
  }), { ...config.telegram, ...TELEGRAM_BOT_PROFILE });
  if (config.telegram.enabled && !telegramGateway.isConfigured()) {
    throw new Error("TELEGRAM_POLLING_ENABLED=true requires a valid TELEGRAM_BOT_TOKEN.");
  }
  const server = createServer(async (req, res) => {
    const requestUrl = new URL(req.url, `http://${req.headers.host}`);
    try {
      if (requestUrl.pathname === "/api/summary") return json(res, 200, await summaryFor(requestUrl.searchParams.get("q")));
      if (requestUrl.pathname === "/api/cache/refresh") {
        if (req.method !== "POST") return json(res, 405, { error: "Используйте POST" });
        clearAllCaches();
        const startedAt = Date.now();
        const body = await summaryFor(requestUrl.searchParams.get("q"));
        return json(res, 200, {
          ...body,
          cacheRefresh: { refreshed: true, completedAt: new Date().toISOString(), durationMs: Date.now() - startedAt },
        });
      }
      if (requestUrl.pathname === "/api/stations") {
        const mode = requestUrl.searchParams.get("mode") === "viewport" ? "viewport" : "full";
        return json(res, 200, await searchStations(readBbox(requestUrl.searchParams), { mode }));
      }
      if (requestUrl.pathname === "/api/health") return json(res, 200, {
        ok: true,
        build: buildInfo,
        sberWorker: sberWorker.status(),
        telegram: telegramGateway.status(),
      });

      const requested = requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
      const file = normalize(resolve(PUBLIC_DIR, `.${requested}`));
      if (file !== PUBLIC_DIR && !file.startsWith(`${PUBLIC_DIR}${sep}`)) return json(res, 403, { error: "Forbidden" });
      const content = await readFile(file);
      res.writeHead(200, { "Content-Type": mime[extname(file)] || "application/octet-stream" });
      res.end(content);
    } catch (error) {
      if (error.code === "ENOENT") return json(res, 404, { error: "Не найдено" });
      json(res, 400, { error: error.message || "Ошибка сервера" });
    }
  }).listen(port, host, () => {
    if (config.telegram.enabled) telegramGateway.start();
    console.log(`Benz AI: http://${host}:${port}`);
  });
  server.on("close", () => {
    telegramGateway.stop().catch(() => {});
    sberWorker.close().catch(() => {});
  });
  return server;
}

if (resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  const server = startServer();
  const shutdown = () => server.close(() => process.exit(0));
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
