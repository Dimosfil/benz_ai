import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { clearGdebenzCache, fetchGdebenz } from "./providers/gdebenz.js";
import { SberBrowserWorker } from "./providers/sber-browser.js";

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = join(process.cwd(), "public");
const CACHE_TTL_MS = 2 * 60 * 1000;
const GEOCODE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const TBANK_PAGE_LIMIT = 300;
const MAX_TBANK_REQUESTS = 40;
const MAX_SPLIT_DEPTH = 4;
const BENZUP_API_URL = process.env.BENZUP_API_URL || "https://api.omt-consult.ru/v2/stations";
const ENABLE_YANDEX_PRICES = /^(1|true|yes)$/i.test(process.env.ENABLE_YANDEX_PRICES || "");
const YANDEX_PRICE_LIMIT = Math.max(1, Number(process.env.YANDEX_PRICE_LIMIT || 30));
const YANDEX_PRICE_CACHE_TTL_MS = 15 * 60 * 1000;
const cache = new Map();
const geocodeCache = new Map();
const yandexPriceCache = new Map();
let geocodeQueue = Promise.resolve();
let lastGeocodeAt = 0;
const sberWorker = new SberBrowserWorker({ refreshMs: 60_000 });

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
  return bbox;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function scheduleGeocode(task) {
  const scheduled = geocodeQueue.then(async () => {
    await wait(Math.max(0, 1_000 - (Date.now() - lastGeocodeAt)));
    try { return await task(); }
    finally { lastGeocodeAt = Date.now(); }
  });
  geocodeQueue = scheduled.catch(() => {});
  return scheduled;
}

async function geocodeLocation(rawQuery) {
  const query = String(rawQuery || "").trim();
  if (query.length < 2 || query.length > 100) throw new Error("Введите город или область — от 2 до 100 символов");
  const key = query.toLocaleLowerCase("ru-RU");
  const saved = geocodeCache.get(key);
  if (saved && Date.now() - saved.createdAt < GEOCODE_CACHE_TTL_MS) return saved.value;

  const place = await scheduleGeocode(async () => {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.search = new URLSearchParams({
      q: query,
      format: "jsonv2",
      limit: "5",
      countrycodes: "ru",
      addressdetails: "1",
      "accept-language": "ru",
      layer: "address",
    });
    const response = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
      headers: { Accept: "application/json", "User-Agent": process.env.GEOCODER_USER_AGENT || "BenzAI/0.1 local fuel search" },
    });
    if (!response.ok) throw new Error(`Сервис поиска территорий вернул HTTP ${response.status}`);
    const results = await response.json();
    const found = Array.isArray(results) && results.find((item) => Array.isArray(item.boundingbox) && item.boundingbox.length === 4);
    if (!found) throw new Error(`Не удалось найти «${query}» в России`);
    const [minLat, maxLat, minLon, maxLon] = found.boundingbox.map(Number);
    return {
      name: found.name || found.display_name,
      displayName: found.display_name,
      type: found.addresstype || found.type,
      lat: Number(found.lat),
      lon: Number(found.lon),
      bbox: { minLat, maxLat, minLon, maxLon },
      attribution: found.licence || "© OpenStreetMap contributors",
    };
  });
  geocodeCache.set(key, { createdAt: Date.now(), value: place });
  return place;
}

function normalizeTbank(station) {
  return {
    source: "tbank",
    sourceRefs: [{ source: "tbank", externalId: station.id }],
    externalId: station.id,
    name: station.name || "Без названия",
    address: station.addr || "Адрес не указан",
    lat: station.lat,
    lon: station.lon,
    overallStatus: station.status || "no_data",
    fuelStatus: station.statusByFuelType && typeof station.statusByFuelType === "object" ? station.statusByFuelType : {},
    availabilityBySource: {
      tbank: {
        overallStatus: station.status || "no_data",
        fuelStatus: station.statusByFuelType && typeof station.statusByFuelType === "object" ? station.statusByFuelType : {},
        observedAt: station.lastTransactionAt || null,
      },
    },
    confidence: typeof station.confidence === "number" ? station.confidence : null,
    lastTransactionAt: station.lastTransactionAt || null,
    prices: {},
    priceUpdatedAt: null,
    yandexOrgId: station.yandexOrgId ? String(station.yandexOrgId) : null,
    links: station.yandexOrgId ? { yandex: `https://yandex.ru/maps/org/${station.yandexOrgId}/` } : {},
  };
}

async function fetchTbankPage(bbox) {
  const url = new URL("https://toplivo.tbank.ru/api/v1/stations");
  url.search = new URLSearchParams(Object.entries(bbox).map(([key, value]) => [key, String(value)])).toString();
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`T-Bank вернул HTTP ${response.status}`);
  const data = await response.json();
  if (data.status !== "ok" || !Array.isArray(data.payload)) throw new Error("Неожиданный ответ T-Bank");
  return data.payload.map(normalizeTbank);
}

function splitBbox(bbox) {
  const midLat = (bbox.minLat + bbox.maxLat) / 2;
  const midLon = (bbox.minLon + bbox.maxLon) / 2;
  return [
    { minLat: bbox.minLat, maxLat: midLat, minLon: bbox.minLon, maxLon: midLon },
    { minLat: bbox.minLat, maxLat: midLat, minLon: midLon, maxLon: bbox.maxLon },
    { minLat: midLat, maxLat: bbox.maxLat, minLon: bbox.minLon, maxLon: midLon },
    { minLat: midLat, maxLat: bbox.maxLat, minLon: midLon, maxLon: bbox.maxLon },
  ];
}

async function fetchTbank(bbox) {
  let requests = 0;
  let truncated = false;
  async function visit(part, depth) {
    if (requests >= MAX_TBANK_REQUESTS) {
      truncated = true;
      return [];
    }
    requests += 1;
    const stations = await fetchTbankPage(part);
    if (stations.length < TBANK_PAGE_LIMIT) return stations;
    if (depth >= MAX_SPLIT_DEPTH) {
      truncated = true;
      return stations;
    }
    const nested = [];
    for (const child of splitBbox(part)) nested.push(...await visit(child, depth + 1));
    return nested;
  }
  const stations = await visit(bbox, 0);
  return { stations: [...new Map(stations.map((station) => [station.externalId, station])).values()], truncated, requests };
}

function inBbox(station, bbox) {
  return Number.isFinite(station.lat) && Number.isFinite(station.lon)
    && station.lat >= bbox.minLat && station.lat <= bbox.maxLat
    && station.lon >= bbox.minLon && station.lon <= bbox.maxLon;
}

export function normalizeFuelName(value) {
  const name = String(value || "").trim().toLocaleUpperCase("ru-RU").replace(/Ё/g, "Е");
  const octane = name.match(/(?:АИ[-‑ ]?)?(80|92|95|98|100)/)?.[1];
  if (octane) return octane;
  if (/ДТ|ДИЗЕЛ|DIESEL/.test(name)) return "DT";
  if (/ПРОПАН|СУГ|LPG|PROPANE/.test(name)) return "LPG";
  if (/МЕТАН|КПГ|CNG|METHANE/.test(name)) return "CNG";
  return name || "OTHER";
}

function normalizeBenzupPrice(item) {
  const value = Number(item?.price?.value ?? item?.price ?? item?.value ?? item?.retailPrice);
  if (!Number.isFinite(value) || value <= 0) return null;
  return {
    fuel: normalizeFuelName(item?.product?.name ?? item?.fuelName ?? item?.fuel ?? item?.type ?? item?.name),
    value,
    currency: item?.price?.currency ?? item?.currency ?? "RUB",
  };
}

export function normalizeBenzupStation(station) {
  const lat = Number(station.lat ?? station.latitude ?? station.location?.lat ?? station.coordinates?.[1]);
  const lon = Number(station.lon ?? station.lng ?? station.longitude ?? station.location?.lon ?? station.coordinates?.[0]);
  const rawPrices = station.prices ?? station.products ?? station.fuels ?? [];
  const prices = {};
  for (const item of Array.isArray(rawPrices) ? rawPrices : Object.values(rawPrices || {})) {
    const price = normalizeBenzupPrice(item);
    if (price) prices[price.fuel] = { value: price.value, currency: price.currency, source: "benzup" };
  }
  const externalId = String(station.id ?? station.stationId ?? station.azs_id ?? "");
  return {
    source: "benzup",
    sourceRefs: [{ source: "benzup", externalId }],
    externalId,
    name: station.name ?? station.title ?? station.brand?.name ?? station.brand ?? "АЗС",
    address: station.address?.formatted ?? station.address ?? station.addr ?? "Адрес не указан",
    lat,
    lon,
    overallStatus: "no_data",
    fuelStatus: {},
    availabilityBySource: {},
    confidence: null,
    lastTransactionAt: null,
    prices,
    priceUpdatedAt: station.priceUpdatedAt ?? station.updatedAt ?? station.updated_at ?? null,
    yandexOrgId: null,
    links: {},
  };
}

async function fetchBenzup(bbox) {
  const token = process.env.BENZUP_API_TOKEN;
  if (!token) return { stations: [], available: false, configured: false, warning: "BenzUp не подключён: задайте BENZUP_API_TOKEN." };
  const response = await fetch(BENZUP_API_URL, {
    signal: AbortSignal.timeout(30_000),
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`BenzUp вернул HTTP ${response.status}`);
  const data = await response.json();
  const rows = Array.isArray(data) ? data : data.data ?? data.stations ?? data.result;
  if (!Array.isArray(rows)) throw new Error("BenzUp вернул неизвестный формат списка АЗС");
  return { stations: rows.map(normalizeBenzupStation).filter((station) => inBbox(station, bbox)), available: true, configured: true };
}

function normalizeSberStatus(value) {
  return ({ available: "available", stale: "maybe_available", unknown: "no_data" })[value] || "no_data";
}

export function normalizeSberStation(station) {
  const fuelStatus = {};
  for (const fuel of station.fuels || []) fuelStatus[normalizeFuelName(fuel.type)] = normalizeSberStatus(fuel.availabilityStatus);
  const overallStatus = normalizeSberStatus(station.availabilityStatus);
  const externalId = String(station.id || station.branchId || "");
  const lastTransactionAt = station.lastPaymentAt || null;
  return {
    source: "sber",
    sourceRefs: [{ source: "sber", externalId }],
    externalId,
    name: station.name || "АЗС",
    address: station.address || station.location?.address || "Адрес не указан",
    lat: Number(station.location?.lat),
    lon: Number(station.location?.lon),
    overallStatus,
    fuelStatus,
    availabilityBySource: {
      sber: {
        overallStatus,
        fuelStatus,
        observedAt: lastTransactionAt,
        operationsCount: Number(station.operationsCount) || 0,
        crowdState: station.crowdState || null,
      },
    },
    confidence: Number(station.crowdState?.confidence) || null,
    lastTransactionAt,
    prices: {},
    priceUpdatedAt: null,
    yandexOrgId: null,
    links: station.externalIds?.twoGisBranchId ? { twoGis: `https://2gis.ru/firm/${station.externalIds.twoGisBranchId}` } : {},
  };
}

async function fetchSber(bbox) {
  const data = await sberWorker.getStations(bbox);
  if (!Array.isArray(data.stations)) throw new Error("Sber AZS вернул неизвестный формат ответа");
  return {
    stations: data.stations.map(normalizeSberStation),
    available: true,
    configured: true,
    fetchedAt: data.fetchedAt,
    version: data.version || null,
    worker: sberWorker.status(),
  };
}

function decodeEmbeddedHtml(value) {
  return value
    .replaceAll("\\u003c", "<")
    .replaceAll("\\u003e", ">")
    .replaceAll("\\u0026", "&")
    .replaceAll('\\"', '"')
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&");
}

async function fetchYandexPrices(station) {
  if (!station.yandexOrgId) return station;
  const saved = yandexPriceCache.get(station.yandexOrgId);
  if (saved && Date.now() - saved.createdAt < YANDEX_PRICE_CACHE_TTL_MS) return { ...station, ...saved.value };
  const response = await fetch(`https://yandex.ru/maps/org/${station.yandexOrgId}/`, {
    signal: AbortSignal.timeout(15_000),
    headers: { "User-Agent": "Mozilla/5.0 BenzAI/0.1", "Accept-Language": "ru-RU,ru;q=0.9" },
  });
  if (!response.ok) throw new Error(`Яндекс Карты вернули HTTP ${response.status}`);
  const parsed = parseYandexFuelPrices(await response.text());
  const value = { prices: { ...station.prices, ...parsed.prices }, priceUpdatedAt: parsed.updatedAt };
  yandexPriceCache.set(station.yandexOrgId, { createdAt: Date.now(), value });
  return { ...station, ...value };
}

export function parseYandexFuelPrices(rawHtml) {
  const html = decodeEmbeddedHtml(rawHtml);
  const pattern = /search-fuel-info-view__name"[^>]*>(?<fuel>[^<]+)<\/div><div class="search-fuel-info-view__value"[^>]*>(?<price>[^<]*)<\/div>/g;
  const prices = {};
  for (const match of html.matchAll(pattern)) {
    const value = Number(match.groups.price.replace(",", ".").replace(/[^0-9.]/g, ""));
    if (Number.isFinite(value) && value > 0) prices[normalizeFuelName(match.groups.fuel)] = { value, currency: "RUB", source: "yandex" };
  }
  const updated = html.match(/Обновлено (?<date>[^<\\]{1,80}) по данным/)?.groups?.date ?? null;
  return { prices, updatedAt: updated };
}

async function enrichYandexPrices(stations) {
  if (!ENABLE_YANDEX_PRICES) return { stations, attempted: 0, warning: "Цены Яндекс Карт отключены: включайте ENABLE_YANDEX_PRICES=1 только при разрешённом использовании данных." };
  const candidates = stations.filter((station) => station.yandexOrgId).slice(0, YANDEX_PRICE_LIMIT);
  let cursor = 0;
  const output = [...stations];
  const errors = [];
  async function worker() {
    while (cursor < candidates.length) {
      const candidate = candidates[cursor++];
      const index = output.indexOf(candidate);
      try { output[index] = await fetchYandexPrices(candidate); }
      catch (error) { errors.push(`${candidate.name}: ${error.message}`); }
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, candidates.length) }, worker));
  const warnings = [];
  if (stations.filter((station) => station.yandexOrgId).length > candidates.length) warnings.push(`Цены Яндекса проверены только для первых ${candidates.length} АЗС.`);
  if (errors.length) warnings.push(`Не удалось получить цены Яндекса для ${errors.length} АЗС.`);
  return { stations: output, attempted: candidates.length, warning: warnings.join(" ") || null };
}

function distanceMeters(left, right) {
  const radians = (value) => value * Math.PI / 180;
  const dLat = radians(right.lat - left.lat);
  const dLon = radians(right.lon - left.lon);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(left.lat)) * Math.cos(radians(right.lat)) * Math.sin(dLon / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function stationNameKey(value) {
  return String(value || "").toLocaleLowerCase("ru-RU").replace(/[^a-zа-я0-9]/giu, "");
}

function aggregateStatuses(values) {
  const known = values.filter((value) => value && value !== "no_data");
  if (!known.length) return "no_data";
  const unique = new Set(known);
  if (unique.size === 1) return known[0];
  return "maybe_available";
}

function recomputeAvailability(station) {
  const evidence = Object.values(station.availabilityBySource || {});
  station.overallStatus = aggregateStatuses(evidence.map((item) => item.overallStatus));
  const fuels = new Set(evidence.flatMap((item) => Object.keys(item.fuelStatus || {})));
  station.fuelStatus = Object.fromEntries([...fuels].map((fuel) => [
    fuel,
    aggregateStatuses(evidence.map((item) => item.fuelStatus?.[fuel]).filter(Boolean)),
  ]));
  const observed = evidence.map((item) => item.observedAt).filter((value) => Number.isFinite(Date.parse(value)));
  station.lastTransactionAt = observed.length ? new Date(Math.max(...observed.map(Date.parse))).toISOString() : station.lastTransactionAt;
  return station;
}

export function mergeStations(stations) {
  const merged = [];
  for (const station of stations) {
    const nameKey = stationNameKey(station.name);
    const match = merged.find((candidate) => {
      if (station.yandexOrgId && candidate.yandexOrgId === station.yandexOrgId) return true;
      if (![station.lat, station.lon, candidate.lat, candidate.lon].every(Number.isFinite)) return false;
      const distance = distanceMeters(station, candidate);
      return distance <= 40 || (distance <= 150 && nameKey && nameKey === stationNameKey(candidate.name));
    });
    if (!match) {
      merged.push(structuredClone(station));
      continue;
    }
    const refs = [...(match.sourceRefs || []), ...(station.sourceRefs || [])];
    match.sourceRefs = [...new Map(refs.map((ref) => [`${ref.source}:${ref.externalId}`, ref])).values()];
    match.prices = { ...(match.prices || {}), ...(station.prices || {}) };
    match.links = { ...(match.links || {}), ...(station.links || {}) };
    match.availabilityBySource = { ...(match.availabilityBySource || {}), ...(station.availabilityBySource || {}) };
    match.yandexOrgId ||= station.yandexOrgId;
    match.priceUpdatedAt ||= station.priceUpdatedAt;
  }
  return merged.map(recomputeAvailability);
}

async function searchStations(bbox) {
  const key = JSON.stringify(bbox);
  const saved = cache.get(key);
  if (saved && Date.now() - saved.createdAt < CACHE_TTL_MS) return { ...saved.value, cached: true };

  const [tbank, sber, benzup, gdebenz] = await Promise.allSettled([
    fetchTbank(bbox),
    fetchSber(bbox),
    fetchBenzup(bbox),
    fetchGdebenz(bbox),
  ]);
  const warnings = [];
  let stations = [];
  if (tbank.status === "fulfilled") {
    stations.push(...tbank.value.stations);
    if (tbank.value.truncated) warnings.push("Область очень велика: достигнут лимит запросов, сводка может быть неполной.");
  }
  else warnings.push(tbank.reason.message || "Не удалось получить данные T-Bank.");
  if (sber.status === "fulfilled") {
    stations.push(...sber.value.stations);
    if (sber.value.warning) warnings.push(sber.value.warning);
  } else warnings.push(sber.reason.message || "Не удалось получить данные Sber AZS.");
  if (benzup.status === "fulfilled") {
    stations.push(...benzup.value.stations);
    if (benzup.value.warning) warnings.push(benzup.value.warning);
  } else warnings.push(benzup.reason.message || "Не удалось получить данные BenzUp.");
  if (gdebenz.status === "fulfilled") {
    stations.push(...gdebenz.value.stations);
  } else warnings.push(gdebenz.reason.message || "Не удалось получить данные ГдеБЕНЗ.");
  stations = mergeStations(stations);
  const yandex = await enrichYandexPrices(stations);
  stations = yandex.stations;
  if (yandex.warning) warnings.push(yandex.warning);
  const value = {
    stations,
    warnings,
    sourceRequests: {
      tbank: tbank.status === "fulfilled" ? tbank.value.requests : 0,
      sber: sber.status === "fulfilled" ? 1 : 0,
      gdebenz: gdebenz.status === "fulfilled" ? 1 : 0,
      yandex: yandex.attempted,
    },
    sources: {
      tbank: { available: tbank.status === "fulfilled", configured: true, role: "availability" },
      sber: {
        available: sber.status === "fulfilled" && sber.value.available,
        configured: true,
        role: "availability",
        refreshedAt: sber.status === "fulfilled" ? new Date(sber.value.fetchedAt).toISOString() : null,
        refreshSeconds: 60,
        error: sber.status === "rejected" ? sber.reason.message : null,
      },
      benzup: { available: benzup.status === "fulfilled" && benzup.value.available, configured: benzup.status === "fulfilled" && benzup.value.configured, role: "prices" },
      yandex: { available: ENABLE_YANDEX_PRICES && yandex.attempted > 0, configured: ENABLE_YANDEX_PRICES, role: "prices" },
      gdebenz: {
        available: gdebenz.status === "fulfilled" && gdebenz.value.available,
        configured: true,
        role: "availability",
        refreshedAt: gdebenz.status === "fulfilled" ? gdebenz.value.updatedAt : null,
        radiusKm: gdebenz.status === "fulfilled" ? gdebenz.value.radiusKm : null,
        error: gdebenz.status === "rejected" ? gdebenz.reason.message : null,
      },
    },
  };
  cache.set(key, { createdAt: Date.now(), value });
  return { ...value, cached: false };
}

function summarize(stations) {
  const statuses = { available: 0, maybe_available: 0, not_available: 0, no_data: 0 };
  const fuels = {};
  const brands = new Map();
  const timestamps = [];
  let withPrices = 0;
  for (const station of stations) {
    statuses[station.overallStatus] = (statuses[station.overallStatus] || 0) + 1;
    for (const [fuel, status] of Object.entries(station.fuelStatus)) {
      fuels[fuel] ||= { available: 0, maybe_available: 0, not_available: 0, no_data: 0, total: 0 };
      fuels[fuel][status] = (fuels[fuel][status] || 0) + 1;
      fuels[fuel].total += 1;
    }
    const brandKey = station.name.trim().toLocaleLowerCase("ru-RU");
    const brand = brands.get(brandKey) || { name: station.name.trim(), count: 0 };
    brand.count += 1;
    brands.set(brandKey, brand);
    const timestamp = Date.parse(station.lastTransactionAt);
    if (Number.isFinite(timestamp)) timestamps.push(timestamp);
    if (Object.keys(station.prices || {}).length) withPrices += 1;
  }
  const now = Date.now();
  return {
    total: stations.length,
    statuses,
    fuels,
    brands: [...brands.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "ru")).slice(0, 10),
    withPrices,
    freshness: {
      withTimestamp: timestamps.length,
      recent24h: timestamps.filter((value) => now - value <= 24 * 60 * 60 * 1000).length,
      recent72h: timestamps.filter((value) => now - value <= 72 * 60 * 60 * 1000).length,
      latestAt: timestamps.length ? new Date(Math.max(...timestamps)).toISOString() : null,
    },
  };
}

function clearAllCaches() {
  cache.clear();
  geocodeCache.clear();
  yandexPriceCache.clear();
  clearGdebenzCache();
  sberWorker.invalidateAll();
}

const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };

export function startServer(port = PORT) {
  const server = createServer(async (req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (requestUrl.pathname === "/api/summary") {
      const location = await geocodeLocation(requestUrl.searchParams.get("q"));
      const result = await searchStations(location.bbox);
      return json(res, 200, { ...result, location, summary: summarize(result.stations) });
    }
    if (requestUrl.pathname === "/api/cache/refresh") {
      if (req.method !== "POST") return json(res, 405, { error: "Используйте POST" });
      clearAllCaches();
      const startedAt = Date.now();
      const location = await geocodeLocation(requestUrl.searchParams.get("q"));
      const result = await searchStations(location.bbox);
      return json(res, 200, {
        ...result,
        location,
        summary: summarize(result.stations),
        cacheRefresh: { refreshed: true, completedAt: new Date().toISOString(), durationMs: Date.now() - startedAt },
      });
    }
    if (requestUrl.pathname === "/api/stations") return json(res, 200, await searchStations(readBbox(requestUrl.searchParams)));
    if (requestUrl.pathname === "/api/health") return json(res, 200, { ok: true, sberWorker: sberWorker.status() });
    const requested = requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
    const file = normalize(join(PUBLIC_DIR, requested));
    if (!file.startsWith(PUBLIC_DIR)) return json(res, 403, { error: "Forbidden" });
    const content = await readFile(file);
    res.writeHead(200, { "Content-Type": mime[extname(file)] || "application/octet-stream" });
    res.end(content);
  } catch (error) {
    if (error.code === "ENOENT") return json(res, 404, { error: "Не найдено" });
    json(res, 400, { error: error.message || "Ошибка сервера" });
  }
  }).listen(port, () => console.log(`Benz AI: http://localhost:${port}`));
  server.on("close", () => { sberWorker.close().catch(() => {}); });
  return server;
}

if (resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  const server = startServer();
  const shutdown = () => server.close(() => process.exit(0));
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
