import { config } from "../config.js";
import { inBbox, normalizeFuelName } from "../domain/stations.js";

let snapshotCache = null;
let snapshotPromise = null;
let cacheGeneration = 0;

export function clearBenzupCache() {
  cacheGeneration += 1;
  snapshotCache = null;
  snapshotPromise = null;
}

function waitForSnapshot(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason || new Error("BenzUp request aborted"));
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason || new Error("BenzUp request aborted"));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

function normalizePrice(item) {
  const value = Number(item?.price?.value ?? item?.price ?? item?.value ?? item?.retailPrice);
  if (!Number.isFinite(value) || value <= 0) return null;
  const rawFuel = item?.product?.name ?? item?.fuelName ?? item?.fuel ?? item?.type ?? item?.name;
  if (!String(rawFuel || "").trim()) return null;
  return {
    fuel: normalizeFuelName(rawFuel),
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
    const price = normalizePrice(item);
    if (price) prices[price.fuel] = { value: price.value, currency: price.currency, source: "benzup" };
  }
  const externalId = String(station.id ?? station.stationId ?? station.azs_id ?? "");
  const rawName = station.name ?? station.title ?? station.brand?.name
    ?? (typeof station.brand === "string" ? station.brand : null);
  const rawAddress = station.address?.formatted ?? station.address?.full
    ?? (typeof station.address === "string" ? station.address : null)
    ?? station.addr;
  return {
    source: "benzup",
    sourceRefs: [{ source: "benzup", externalId }],
    externalId,
    name: String(rawName || "АЗС").trim() || "АЗС",
    address: String(rawAddress || "Адрес не указан").trim() || "Адрес не указан",
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

export async function fetchBenzup(bbox, { signal } = {}) {
  if (!config.benzup.token) return { stations: [], available: false, configured: false, warning: "BenzUp не подключён: задайте BENZUP_API_TOKEN." };
  const fresh = snapshotCache && Date.now() - snapshotCache.createdAt < config.benzup.cacheTtlMs;
  if (!fresh && !snapshotPromise) {
    const generation = cacheGeneration;
    const request = (async () => {
      const response = await fetch(config.benzup.url, {
        signal: AbortSignal.timeout(config.benzup.timeoutMs),
        headers: { Accept: "application/json", Authorization: `Bearer ${config.benzup.token}` },
      });
      if (!response.ok) throw new Error(`BenzUp вернул HTTP ${response.status}`);
      const data = await response.json();
      const rows = Array.isArray(data) ? data : data.data ?? data.stations ?? data.result;
      if (!Array.isArray(rows)) throw new Error("BenzUp вернул неизвестный формат списка АЗС");
      const normalized = rows.map(normalizeBenzupStation);
      const stations = normalized.filter((station) => station.externalId && Number.isFinite(station.lat) && Number.isFinite(station.lon));
      const snapshot = { createdAt: Date.now(), stations, returned: rows.length, invalid: normalized.length - stations.length };
      if (generation === cacheGeneration) snapshotCache = snapshot;
      return snapshot;
    })();
    snapshotPromise = request;
    const release = () => {
      if (snapshotPromise === request) snapshotPromise = null;
    };
    request.then(release, release);
  }
  const snapshot = fresh ? snapshotCache : await waitForSnapshot(snapshotPromise, signal);
  return {
    stations: snapshot.stations.filter((station) => inBbox(station, bbox)),
    available: true,
    configured: true,
    cached: fresh,
    returned: snapshot.returned,
    invalid: snapshot.invalid,
  };
}
