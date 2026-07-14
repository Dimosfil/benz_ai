import { config } from "../config.js";
import { inBbox, normalizeFuelName } from "../domain/stations.js";

let snapshotCache = null;
let snapshotPromise = null;
let cacheGeneration = 0;
const sessionCookies = new Map();

export function clearAlfaCache() {
  cacheGeneration += 1;
  snapshotCache = null;
  snapshotPromise = null;
}

export function resetAlfaSession() {
  sessionCookies.clear();
}

function fuelName(value) {
  if (String(value || "").toLocaleUpperCase("ru-RU") === "AI98_100") return "98/100";
  return normalizeFuelName(value);
}

function fuelStatus(value) {
  return ({
    available: "available",
    probably_available: "maybe_available",
    probably_unavailable: "not_available",
    unavailable: "not_available",
    closed: "not_available",
    unknown: "no_data",
  })[value] || "no_data";
}

function aggregateStatus(values) {
  const known = values.filter((value) => value && value !== "no_data");
  if (!known.length) return "no_data";
  if (known.includes("available")) return "available";
  if (known.includes("maybe_available")) return "maybe_available";
  return "not_available";
}

function latestTimestamp(values) {
  const timestamps = values.filter((value) => Number.isFinite(Date.parse(value)));
  return timestamps.length ? new Date(Math.max(...timestamps.map(Date.parse))).toISOString() : null;
}

function coordinate(value) {
  if (value == null || value === "") return Number.NaN;
  return Number(value);
}

export function normalizeAlfaStation(station) {
  const fuels = Array.isArray(station.fuels) ? station.fuels : [];
  const statuses = {};
  const prices = {};
  const observedAt = [];
  for (const item of fuels) {
    const name = fuelName(item.category);
    statuses[name] = fuelStatus(item.status);
    if (item.last_transaction_at) observedAt.push(item.last_transaction_at);
    const price = Number(item.price);
    if (Number.isFinite(price) && price > 0) prices[name] = { value: price, currency: "RUB", source: "alfa" };
  }

  const overallStatus = aggregateStatus(Object.values(statuses));
  const lastTransactionAt = latestTimestamp(observedAt);
  const externalId = String(station.station_id || station._id?.$oid || "");
  return {
    source: "alfa",
    sourceRefs: [{ source: "alfa", externalId }],
    externalId,
    name: station.brand?.name || "АЗС",
    address: station.address?.fullname || "Адрес не указан",
    lat: coordinate(station.address?.location?.latitude),
    lon: coordinate(station.address?.location?.longitude),
    overallStatus,
    fuelStatus: statuses,
    availabilityBySource: {
      alfa: { overallStatus, fuelStatus: statuses, observedAt: lastTransactionAt },
    },
    confidence: null,
    lastTransactionAt,
    prices,
    // Alfa exposes transaction time, not a separate price publication time.
    priceUpdatedAt: null,
    yandexOrgId: null,
    links: {},
  };
}

export function selectAlfaStations(rows, bbox) {
  const normalized = rows.map(normalizeAlfaStation);
  const valid = normalized.filter((station) => Number.isFinite(station.lat) && Number.isFinite(station.lon));
  const stations = valid.filter((station) => inBbox(station, bbox));
  return {
    stations,
    returned: rows.length,
    invalidCoordinates: normalized.length - valid.length,
    droppedOutside: valid.length - stations.length,
  };
}

function cookieHeader() {
  return [...sessionCookies.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

function rememberCookies(headers) {
  const values = typeof headers.getSetCookie === "function"
    ? headers.getSetCookie()
    : [headers.get("set-cookie")].filter(Boolean);
  for (const value of values) {
    const pair = String(value).split(";", 1)[0];
    const separator = pair.indexOf("=");
    if (separator > 0) sessionCookies.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
}

function requestHeaders() {
  const cookie = cookieHeader();
  return {
    Accept: "application/json",
    "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8",
    Referer: config.alfa.pageUrl,
    "User-Agent": config.alfa.userAgent,
    ...(cookie ? { Cookie: cookie } : {}),
  };
}

export async function requestAlfaRows(url, fetchImpl = globalThis.fetch) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetchImpl(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(config.alfa.timeoutMs),
      headers: requestHeaders(),
    });
    rememberCookies(response.headers);
    if (response.ok) {
      const data = await response.json();
      if (!Array.isArray(data) || data.some((row) => !row?.station_id || !row.address?.location || !Array.isArray(row.fuels))) {
        throw new Error("Alfa AZS вернул неизвестный формат ответа");
      }
      return data;
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      continue;
    }
    if (response.status === 403 && sessionCookies.size && attempt < 2) {
      sessionCookies.clear();
      await response.body?.cancel();
      continue;
    }
    throw new Error(`Alfa AZS вернул HTTP ${response.status}`);
  }
  throw new Error("Alfa AZS не завершил защитную HTTP-проверку");
}

function requestUrl(bbox) {
  const lon = (bbox.minLon + bbox.maxLon) / 2;
  const lat = (bbox.minLat + bbox.maxLat) / 2;
  const url = new URL(config.alfa.url);
  url.search = new URLSearchParams({ g: JSON.stringify([lon, lat]), z: String(config.alfa.zoom) });
  return url;
}

async function getSnapshot(bbox, fetchImpl) {
  if (snapshotCache && Date.now() - snapshotCache.createdAt < config.alfa.cacheTtlMs) {
    return { ...snapshotCache, cached: true };
  }
  if (!snapshotPromise) {
    const generation = cacheGeneration;
    const loading = requestAlfaRows(requestUrl(bbox), fetchImpl)
      .then((rows) => {
        const stations = rows.map(normalizeAlfaStation);
        const valid = stations.filter((station) => Number.isFinite(station.lat) && Number.isFinite(station.lon));
        const snapshot = {
          stations: valid,
          returned: rows.length,
          invalidCoordinates: stations.length - valid.length,
          createdAt: Date.now(),
        };
        if (generation === cacheGeneration) snapshotCache = snapshot;
        return snapshot;
      })
      .finally(() => {
        if (snapshotPromise === loading) snapshotPromise = null;
      });
    snapshotPromise = loading;
  }
  return { ...await snapshotPromise, cached: false };
}

export async function fetchAlfa(bbox, fetchImpl = globalThis.fetch) {
  const snapshot = await getSnapshot(bbox, fetchImpl);
  const stations = snapshot.stations.filter((station) => inBbox(station, bbox));
  return {
    stations,
    returned: snapshot.returned,
    invalidCoordinates: snapshot.invalidCoordinates,
    droppedOutside: snapshot.stations.length - stations.length,
    available: true,
    cached: snapshot.cached,
    fetchedAt: snapshot.createdAt,
  };
}
