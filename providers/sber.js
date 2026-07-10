import { normalizeFuelName } from "../domain/stations.js";

function normalizeStatus(value) {
  return ({ available: "available", stale: "maybe_available", unknown: "no_data" })[value] || "no_data";
}

export function normalizeSberStation(station) {
  const fuelStatus = {};
  for (const fuel of station.fuels || []) fuelStatus[normalizeFuelName(fuel.type)] = normalizeStatus(fuel.availabilityStatus);
  const overallStatus = normalizeStatus(station.availabilityStatus);
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

export async function fetchSber(worker, bbox) {
  const data = await worker.getStations(bbox);
  if (!Array.isArray(data.stations)) throw new Error("Sber AZS вернул неизвестный формат ответа");
  return {
    stations: data.stations.map(normalizeSberStation),
    available: true,
    configured: true,
    fetchedAt: data.fetchedAt,
    version: data.version || null,
    worker: worker.status(),
  };
}
