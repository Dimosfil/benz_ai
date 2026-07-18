import { inBbox, normalizeFuelName } from "../domain/stations.js";

function normalizeStatus(value) {
  return ({ available: "available", stale: "maybe_available", unknown: "no_data" })[value] || "no_data";
}

export function normalizeSberStation(station) {
  const fuelStatus = {};
  for (const fuel of station.fuels || []) fuelStatus[normalizeFuelName(fuel.type)] = normalizeStatus(fuel.availabilityStatus);
  const overallStatus = normalizeStatus(station.availabilityStatus);
  const externalId = String(station.id || station.branchId || "");
  const lastTransactionAt = station.lastPaymentAt || null;
  const operationsCount = station.operationsCount == null || station.operationsCount === ""
    ? null
    : Number(station.operationsCount);
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
        operationsCount: Number.isFinite(operationsCount) ? operationsCount : null,
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

export async function fetchSber(worker, bbox) {
  const data = await worker.getStations(bbox);
  if (!Array.isArray(data.stations)) throw new Error("Sber AZS вернул неизвестный формат ответа");
  const normalized = data.stations.map(normalizeSberStation);
  const valid = normalized.filter((station) => station.externalId && Number.isFinite(station.lat) && Number.isFinite(station.lon));
  const stations = valid.filter((station) => inBbox(station, bbox));
  return {
    stations,
    available: true,
    configured: true,
    fetchedAt: data.fetchedAt,
    version: data.version || null,
    worker: worker.status(),
    returned: data.stations.length,
    invalid: normalized.length - valid.length,
    droppedOutside: valid.length - stations.length,
  };
}
