import { config } from "../config.js";
import { inBbox, normalizeFuelName } from "../domain/stations.js";

function normalizeStatus(value) {
  return new Set(["available", "maybe_available", "not_available", "no_data"]).has(value) ? value : "no_data";
}

export function normalizeTbankStation(station) {
  const externalId = String(station.id ?? "");
  const rawFuelStatus = station.statusByFuelType && typeof station.statusByFuelType === "object" ? station.statusByFuelType : {};
  const fuelStatus = Object.fromEntries(Object.entries(rawFuelStatus)
    .filter(([fuel]) => String(fuel || "").trim())
    .map(([fuel, status]) => [normalizeFuelName(fuel), normalizeStatus(status)])
  );
  const overallStatus = normalizeStatus(station.status);
  return {
    source: "tbank",
    sourceRefs: [{ source: "tbank", externalId }],
    externalId,
    name: station.name || "Без названия",
    address: station.addr || "Адрес не указан",
    lat: Number(station.lat),
    lon: Number(station.lon),
    overallStatus,
    fuelStatus,
    availabilityBySource: { tbank: { overallStatus, fuelStatus, observedAt: station.lastTransactionAt || null } },
    confidence: typeof station.confidence === "number" ? station.confidence : null,
    lastTransactionAt: station.lastTransactionAt || null,
    prices: {},
    priceUpdatedAt: null,
    yandexOrgId: station.yandexOrgId ? String(station.yandexOrgId) : null,
    links: station.yandexOrgId ? { yandex: `https://yandex.ru/maps/org/${station.yandexOrgId}/` } : {},
  };
}

function requestSignal(signal) {
  const timeout = AbortSignal.timeout(config.tbank.timeoutMs);
  return signal && typeof AbortSignal.any === "function" ? AbortSignal.any([signal, timeout]) : timeout;
}

async function fetchPage(bbox, signal) {
  const url = new URL(config.tbank.url);
  url.search = new URLSearchParams(Object.entries(bbox).map(([key, value]) => [key, String(value)])).toString();
  const response = await fetch(url, { signal: requestSignal(signal), headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`T-Bank вернул HTTP ${response.status}`);
  const data = await response.json();
  if (data.status !== "ok" || !Array.isArray(data.payload)) throw new Error("Неожиданный ответ T-Bank");
  return data.payload.map(normalizeTbankStation);
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

export async function fetchTbank(bbox, { signal } = {}) {
  let requests = 0;
  let truncated = false;
  async function visit(part, depth) {
    if (requests >= config.tbank.maxRequests) {
      truncated = true;
      return [];
    }
    requests += 1;
    const stations = await fetchPage(part, signal);
    if (stations.length < config.tbank.pageLimit) return stations;
    if (depth >= config.tbank.maxSplitDepth) {
      truncated = true;
      return stations;
    }
    const nested = [];
    for (const child of splitBbox(part)) {
      if (signal?.aborted) throw signal.reason || new Error("T-Bank request aborted");
      nested.push(...await visit(child, depth + 1));
    }
    return nested;
  }
  const stations = (await visit(bbox, 0)).filter((station) => (
    station.externalId && Number.isFinite(station.lat) && Number.isFinite(station.lon) && inBbox(station, bbox)
  ));
  return {
    stations: [...new Map(stations.map((station) => [station.externalId, station])).values()],
    truncated,
    requests,
  };
}
