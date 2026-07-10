import { config } from "../config.js";
import { inBbox } from "../domain/stations.js";

const cache = new Map();

export function clearMultigoCache() {
  cache.clear();
}

function centerOf(bbox) {
  return {
    lat: (bbox.minLat + bbox.maxLat) / 2,
    lon: (bbox.minLon + bbox.maxLon) / 2,
  };
}

function isElectricOnly(station) {
  const description = [
    station.subCategory?.name,
    station.category?.name,
    ...(station.services || []).map((service) => service?.name),
  ].filter(Boolean).join(" ").toLocaleLowerCase("ru-RU");
  return !station.fuels?.length && /элзс|электрозаряд|зарядн.+электромоб/.test(description);
}

export function selectMultigoStations(rows, bbox) {
  const normalized = rows.map((raw) => ({ raw, station: normalizeMultigoStation(raw) }));
  const inside = normalized.filter(({ station }) => inBbox(station, bbox));
  const stations = inside.filter(({ raw }) => !isElectricOnly(raw)).map(({ station }) => station);
  return {
    stations,
    returned: normalized.length,
    droppedOutside: normalized.length - inside.length,
    droppedElectric: inside.length - stations.length,
  };
}

export function normalizeMultigoStation(station) {
  const externalId = String(station.id || "");
  const category = station.subCategory?.name || station.category?.name || null;
  const rawFuels = Array.isArray(station.fuels) ? station.fuels : [];
  return {
    source: "multigo",
    sourceRefs: [{ source: "multigo", externalId }],
    externalId,
    name: station.name || category || "АЗС",
    address: station.address || "Адрес не указан",
    lat: Number(station.loc?.[0]),
    lon: Number(station.loc?.[1]),
    // The endpoint describes a place, not fuel availability. Do not promote its
    // generic status to an availability claim.
    overallStatus: "no_data",
    fuelStatus: {},
    availabilityBySource: {},
    confidence: null,
    lastTransactionAt: null,
    prices: {},
    priceUpdatedAt: null,
    yandexOrgId: null,
    links: {},
    multigo: {
      status: station.status || null,
      category,
      fuels: rawFuels,
      distanceMeters: Number(station.__dist) || null,
    },
  };
}

export async function fetchMultigo(bbox) {
  const { lat, lon } = centerOf(bbox);
  const key = [bbox.minLat, bbox.maxLat, bbox.minLon, bbox.maxLon].map((value) => value.toFixed(4)).join(",");
  const saved = cache.get(key);
  if (saved && Date.now() - saved.createdAt < config.multigo.cacheTtlMs) return { ...saved.value, cached: true };

  const response = await fetch(config.multigo.url, {
    method: "POST",
    signal: AbortSignal.timeout(config.multigo.timeoutMs),
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": config.sourceUserAgent,
    },
    body: JSON.stringify({ lat, lng: lon, limit: config.multigo.limit }),
  });
  if (!response.ok) throw new Error(`Multigo вернул HTTP ${response.status}`);
  const data = await response.json();
  if (data?.err !== 0 || !Array.isArray(data?.data?.list)) throw new Error("Multigo вернул неизвестный формат ответа");
  const selected = selectMultigoStations(data.data.list, bbox);
  const value = {
    ...selected,
    available: true,
    limit: config.multigo.limit,
  };
  cache.set(key, { createdAt: Date.now(), value });
  return { ...value, cached: false };
}
