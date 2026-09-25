import { config } from "../config.js";
import { readFreshCache, writeBoundedCache } from "../domain/bounded-cache.js";
import { inBbox, normalizeFuelName } from "../domain/stations.js";

const cache = new Map();

export function clearGdebenzCache() {
  cache.clear();
}

function status(value) {
  return ({ yes: "available", queue: "available", low: "maybe_available", no: "not_available" })[value] || "no_data";
}

function fuelName(value) {
  return normalizeFuelName(value);
}

const KNOWN_FUELS = new Set(["80", "92", "95", "98", "100", "DT", "LPG", "CNG"]);

function normalizeDetail(rawDetail, fuels) {
  const detail = String(rawDetail || "").trim();
  const separator = detail.indexOf("·");
  if (separator < 0) return { detail, confirmedFuels: fuels };
  const claimed = detail.slice(0, separator).split(",").map(fuelName);
  if (!claimed.length || claimed.some((fuel) => !KNOWN_FUELS.has(fuel))) {
    return { detail, confirmedFuels: fuels };
  }
  const suffix = detail.slice(separator + 1).trim();
  const claimedSet = new Set(claimed);
  const same = fuels.length === claimedSet.size && fuels.every((fuel) => claimedSet.has(fuel));
  return {
    detail: same ? suffix : `У источника расходятся данные о марках топлива${suffix ? `. ${suffix}` : ""}`,
    confirmedFuels: same ? fuels : fuels.filter((fuel) => claimedSet.has(fuel)),
  };
}

function observedAt(value) {
  if (!value) return null;
  const normalized = String(value).trim().replace(" ", "T");
  const iso = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized) ? normalized : `${normalized}+03:00`;
  return Number.isFinite(Date.parse(iso)) ? iso : null;
}

export function normalizeGdebenzStation(station) {
  const overallStatus = status(station.status);
  const fuels = String(station.fuels_now || "").split(",").map(fuelName).filter(Boolean);
  const { detail, confirmedFuels } = normalizeDetail(station.detail, fuels);
  const fuelStatus = Object.fromEntries(fuels.map((fuel) => [
    fuel, confirmedFuels.includes(fuel) ? overallStatus : "no_data",
  ]));
  const externalId = String(station.osm_id || "");
  const lastTransactionAt = observedAt(station.last_at);
  return {
    source: "gdebenz",
    sourceRefs: [{ source: "gdebenz", externalId }],
    externalId,
    name: station.name || station.brand || "АЗС",
    address: station.addr || "Адрес не указан",
    lat: Number(station.lat),
    lon: Number(station.lon),
    overallStatus,
    fuelStatus,
    availabilityBySource: {
      gdebenz: {
        overallStatus,
        fuelStatus,
        observedAt: lastTransactionAt,
        rawStatus: station.status || null,
        detail,
        confirmations: Number(station.confirmations) || 0,
        confidence: Number(station.confidence_base) || 0,
      },
    },
    confidence: Number(station.confidence_base) || null,
    confirmations: Number(station.confirmations) || 0,
    detail,
    lastTransactionAt,
    prices: {},
    priceUpdatedAt: null,
    yandexOrgId: null,
    links: {},
  };
}

function centerAndRadius(bbox) {
  const lat = (bbox.minLat + bbox.maxLat) / 2;
  const lon = (bbox.minLon + bbox.maxLon) / 2;
  const latKm = (bbox.maxLat - bbox.minLat) * 111;
  const lonKm = (bbox.maxLon - bbox.minLon) * 111 * Math.cos(lat * Math.PI / 180);
  const requestedRadiusKm = Math.max(3, Math.ceil(Math.hypot(latKm, lonKm) / 2));
  const radiusKm = Math.min(config.gdebenz.maxRadiusKm, requestedRadiusKm);
  return { lat, lon, radiusKm, truncated: requestedRadiusKm > radiusKm };
}

export async function fetchGdebenz(bbox, { signal } = {}) {
  const { lat, lon, radiusKm, truncated } = centerAndRadius(bbox);
  const key = [bbox.minLat, bbox.maxLat, bbox.minLon, bbox.maxLon, radiusKm]
    .map((value) => Number(value).toFixed(4)).join(",");
  const saved = readFreshCache(cache, key, config.gdebenz.cacheTtlMs);
  if (saved) return { ...saved, cached: true };
  const url = new URL(config.gdebenz.url);
  url.search = new URLSearchParams({ lat: String(lat), lon: String(lon), radius_km: String(radiusKm) });
  const response = await fetch(url, {
    signal: signal && typeof AbortSignal.any === "function"
      ? AbortSignal.any([signal, AbortSignal.timeout(config.gdebenz.timeoutMs)])
      : AbortSignal.timeout(config.gdebenz.timeoutMs),
    headers: { Accept: "application/json", "User-Agent": config.sourceUserAgent },
  });
  if (!response.ok) throw new Error(`ГдеБЕНЗ вернул HTTP ${response.status}`);
  const data = await response.json();
  if (!Array.isArray(data.stations)) throw new Error("ГдеБЕНЗ вернул неизвестный формат ответа");
  const normalized = data.stations.map(normalizeGdebenzStation);
  const valid = normalized.filter((station) => station.externalId && Number.isFinite(station.lat) && Number.isFinite(station.lon));
  const stations = valid.filter((station) => inBbox(station, bbox));
  const value = {
    stations,
    available: true,
    updatedAt: data.updated || null,
    radiusKm,
    returned: normalized.length,
    invalid: normalized.length - valid.length,
    droppedOutside: valid.length - stations.length,
    truncated,
  };
  writeBoundedCache(cache, key, value, config.providerAreaCacheMaxEntries);
  return { ...value, cached: false };
}
