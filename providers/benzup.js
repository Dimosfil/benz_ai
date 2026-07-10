import { config } from "../config.js";
import { inBbox, normalizeFuelName } from "../domain/stations.js";

function normalizePrice(item) {
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
    const price = normalizePrice(item);
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

export async function fetchBenzup(bbox) {
  if (!config.benzup.token) return { stations: [], available: false, configured: false, warning: "BenzUp не подключён: задайте BENZUP_API_TOKEN." };
  const response = await fetch(config.benzup.url, {
    signal: AbortSignal.timeout(config.benzup.timeoutMs),
    headers: { Accept: "application/json", Authorization: `Bearer ${config.benzup.token}` },
  });
  if (!response.ok) throw new Error(`BenzUp вернул HTTP ${response.status}`);
  const data = await response.json();
  const rows = Array.isArray(data) ? data : data.data ?? data.stations ?? data.result;
  if (!Array.isArray(rows)) throw new Error("BenzUp вернул неизвестный формат списка АЗС");
  return { stations: rows.map(normalizeBenzupStation).filter((station) => inBbox(station, bbox)), available: true, configured: true };
}
