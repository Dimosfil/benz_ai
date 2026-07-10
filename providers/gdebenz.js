const CACHE_TTL_MS = 60_000;
const MAX_RADIUS_KM = 30;

const cache = new Map();

export function clearGdebenzCache() {
  cache.clear();
}

function status(value) {
  return ({ yes: "available", queue: "available", low: "maybe_available", no: "not_available" })[value] || "no_data";
}

function fuelName(value) {
  const raw = String(value || "").trim().toLocaleUpperCase("ru-RU");
  if (/^\d+$/.test(raw)) return raw;
  if (raw === "ДТ") return "DT";
  return raw;
}

function observedAt(value) {
  if (!value) return null;
  const iso = String(value).replace(" ", "T") + "+03:00";
  return Number.isFinite(Date.parse(iso)) ? iso : null;
}

export function normalizeGdebenzStation(station) {
  const overallStatus = status(station.status);
  const fuels = String(station.fuels_now || "").split(",").map(fuelName).filter(Boolean);
  const fuelStatus = Object.fromEntries(fuels.map((fuel) => [fuel, overallStatus]));
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
        detail: station.detail || "",
        confirmations: Number(station.confirmations) || 0,
        confidence: Number(station.confidence_base) || 0,
      },
    },
    confidence: Number(station.confidence_base) || null,
    confirmations: Number(station.confirmations) || 0,
    detail: station.detail || "",
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
  const radiusKm = Math.min(MAX_RADIUS_KM, Math.max(3, Math.ceil(Math.hypot(latKm, lonKm) / 2)));
  return { lat, lon, radiusKm };
}

export async function fetchGdebenz(bbox) {
  const { lat, lon, radiusKm } = centerAndRadius(bbox);
  const key = `${lat.toFixed(4)},${lon.toFixed(4)},${radiusKm}`;
  const saved = cache.get(key);
  if (saved && Date.now() - saved.createdAt < CACHE_TTL_MS) return { ...saved.value, cached: true };
  const url = new URL("https://gdebenz.ru/api/nearby");
  url.search = new URLSearchParams({ lat: String(lat), lon: String(lon), radius_km: String(radiusKm) });
  const response = await fetch(url, {
    signal: AbortSignal.timeout(20_000),
    headers: { Accept: "application/json", "User-Agent": process.env.SOURCE_USER_AGENT || "BenzAI/0.1 local fuel aggregator" },
  });
  if (!response.ok) throw new Error(`ГдеБЕНЗ вернул HTTP ${response.status}`);
  const data = await response.json();
  if (!Array.isArray(data.stations)) throw new Error("ГдеБЕНЗ вернул неизвестный формат ответа");
  const value = {
    stations: data.stations.map(normalizeGdebenzStation),
    available: true,
    updatedAt: data.updated || null,
    radiusKm,
  };
  cache.set(key, { createdAt: Date.now(), value });
  return { ...value, cached: false };
}
