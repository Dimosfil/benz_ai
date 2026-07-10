import { config } from "../config.js";

export function normalizeTbankStation(station) {
  const externalId = String(station.id ?? "");
  const fuelStatus = station.statusByFuelType && typeof station.statusByFuelType === "object" ? station.statusByFuelType : {};
  const overallStatus = station.status || "no_data";
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

async function fetchPage(bbox) {
  const url = new URL(config.tbank.url);
  url.search = new URLSearchParams(Object.entries(bbox).map(([key, value]) => [key, String(value)])).toString();
  const response = await fetch(url, { signal: AbortSignal.timeout(config.tbank.timeoutMs), headers: { Accept: "application/json" } });
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

export async function fetchTbank(bbox) {
  let requests = 0;
  let truncated = false;
  async function visit(part, depth) {
    if (requests >= config.tbank.maxRequests) {
      truncated = true;
      return [];
    }
    requests += 1;
    const stations = await fetchPage(part);
    if (stations.length < config.tbank.pageLimit) return stations;
    if (depth >= config.tbank.maxSplitDepth) {
      truncated = true;
      return stations;
    }
    const nested = [];
    for (const child of splitBbox(part)) nested.push(...await visit(child, depth + 1));
    return nested;
  }
  const stations = await visit(bbox, 0);
  return {
    stations: [...new Map(stations.map((station) => [station.externalId, station])).values()],
    truncated,
    requests,
  };
}
