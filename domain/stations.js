export function inBbox(station, bbox) {
  return Number.isFinite(station.lat) && Number.isFinite(station.lon)
    && station.lat >= bbox.minLat && station.lat <= bbox.maxLat
    && station.lon >= bbox.minLon && station.lon <= bbox.maxLon;
}

export function normalizeFuelName(value) {
  const name = String(value || "").trim().toLocaleUpperCase("ru-RU").replace(/Ё/g, "Е");
  const octane = name.match(/(?:АИ[-‑ ]?)?(80|92|95|98|100)/)?.[1];
  if (octane) return octane;
  if (/ДТ|ДИЗЕЛ|DIESEL/.test(name)) return "DT";
  if (/ПРОПАН|СУГ|LPG|PROPANE/.test(name)) return "LPG";
  if (/МЕТАН|КПГ|CNG|METHANE/.test(name)) return "CNG";
  return name || "OTHER";
}

function distanceMeters(left, right) {
  const radians = (value) => value * Math.PI / 180;
  const dLat = radians(right.lat - left.lat);
  const dLon = radians(right.lon - left.lon);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(radians(left.lat)) * Math.cos(radians(right.lat)) * Math.sin(dLon / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function stationNameKey(value) {
  return String(value || "").toLocaleLowerCase("ru-RU").replace(/[^a-zа-я0-9]/giu, "");
}

function refsOf(station) {
  return station.sourceRefs || (station.source ? [{ source: station.source, externalId: station.externalId }] : []);
}

function refKey(ref) {
  return `${ref.source}:${String(ref.externalId ?? "")}`;
}

function sameProviderIdentity(left, right) {
  const rightKeys = new Set(refsOf(right).filter((ref) => String(ref.externalId ?? "")).map(refKey));
  return refsOf(left).some((ref) => String(ref.externalId ?? "") && rightKeys.has(refKey(ref)));
}

function sharesProvider(left, right) {
  const rightSources = new Set(refsOf(right).map((ref) => ref.source));
  return refsOf(left).some((ref) => rightSources.has(ref.source));
}

function isSameStation(left, right) {
  if (left.yandexOrgId && right.yandexOrgId === left.yandexOrgId) return true;
  if (sameProviderIdentity(left, right)) return true;
  // Different IDs from the same provider represent different source records;
  // proximity must not collapse them into "Multigo + Multigo" or equivalents.
  if (sharesProvider(left, right)) return false;
  if (![left.lat, left.lon, right.lat, right.lon].every(Number.isFinite)) return false;
  const distance = distanceMeters(left, right);
  const leftName = stationNameKey(left.name);
  return distance <= 40 || (distance <= 150 && leftName && leftName === stationNameKey(right.name));
}

function aggregateStatuses(values) {
  const known = values.filter((value) => value && value !== "no_data");
  if (!known.length) return "no_data";
  const unique = new Set(known);
  return unique.size === 1 ? known[0] : "maybe_available";
}

function recomputeAvailability(station) {
  const evidence = Object.values(station.availabilityBySource || {});
  station.overallStatus = aggregateStatuses(evidence.map((item) => item.overallStatus));
  const fuels = new Set(evidence.flatMap((item) => Object.keys(item.fuelStatus || {})));
  station.fuelStatus = Object.fromEntries([...fuels].map((fuel) => [
    fuel,
    aggregateStatuses(evidence.map((item) => item.fuelStatus?.[fuel]).filter(Boolean)),
  ]));
  const observed = evidence.map((item) => item.observedAt).filter((value) => Number.isFinite(Date.parse(value)));
  station.lastTransactionAt = observed.length
    ? new Date(Math.max(...observed.map(Date.parse))).toISOString()
    : station.lastTransactionAt;
  return station;
}

export function mergeStations(stations) {
  const merged = [];
  for (const station of stations) {
    const match = merged.find((candidate) => isSameStation(station, candidate));
    if (!match) {
      merged.push(structuredClone(station));
      continue;
    }
    const refs = [...refsOf(match), ...refsOf(station)];
    match.sourceRefs = [...new Map(refs.map((ref) => [refKey(ref), ref])).values()];
    match.prices = { ...(match.prices || {}), ...(station.prices || {}) };
    match.links = { ...(match.links || {}), ...(station.links || {}) };
    match.availabilityBySource = { ...(match.availabilityBySource || {}), ...(station.availabilityBySource || {}) };
    match.yandexOrgId ||= station.yandexOrgId;
    match.priceUpdatedAt ||= station.priceUpdatedAt;
  }
  return merged.map(recomputeAvailability);
}

export function summarizeStations(stations) {
  const statuses = { available: 0, maybe_available: 0, not_available: 0, no_data: 0 };
  const fuels = {};
  const brands = new Map();
  const timestamps = [];
  let withPrices = 0;
  for (const station of stations) {
    statuses[station.overallStatus] = (statuses[station.overallStatus] || 0) + 1;
    for (const [fuel, status] of Object.entries(station.fuelStatus || {})) {
      fuels[fuel] ||= { available: 0, maybe_available: 0, not_available: 0, no_data: 0, total: 0 };
      fuels[fuel][status] = (fuels[fuel][status] || 0) + 1;
      fuels[fuel].total += 1;
    }
    const brandKey = station.name.trim().toLocaleLowerCase("ru-RU");
    const brand = brands.get(brandKey) || { name: station.name.trim(), count: 0 };
    brand.count += 1;
    brands.set(brandKey, brand);
    const timestamp = Date.parse(station.lastTransactionAt);
    if (Number.isFinite(timestamp)) timestamps.push(timestamp);
    if (Object.keys(station.prices || {}).length) withPrices += 1;
  }
  const now = Date.now();
  return {
    total: stations.length,
    statuses,
    fuels,
    brands: [...brands.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "ru")).slice(0, 10),
    withPrices,
    freshness: {
      withTimestamp: timestamps.length,
      recent24h: timestamps.filter((value) => now - value <= 24 * 60 * 60_000).length,
      recent72h: timestamps.filter((value) => now - value <= 72 * 60 * 60_000).length,
      latestAt: timestamps.length ? new Date(Math.max(...timestamps)).toISOString() : null,
    },
  };
}
