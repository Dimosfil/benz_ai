export function inBbox(station, bbox) {
  return Number.isFinite(station.lat) && Number.isFinite(station.lon)
    && station.lat >= bbox.minLat && station.lat <= bbox.maxLat
    && station.lon >= bbox.minLon && station.lon <= bbox.maxLon;
}

function pointOnSegment(point, left, right) {
  const [x, y] = point;
  const [x1, y1] = left;
  const [x2, y2] = right;
  const cross = (x - x1) * (y2 - y1) - (y - y1) * (x2 - x1);
  if (Math.abs(cross) > 1e-10) return false;
  return x >= Math.min(x1, x2) && x <= Math.max(x1, x2)
    && y >= Math.min(y1, y2) && y <= Math.max(y1, y2);
}

function pointInRing(point, ring) {
  let inside = false;
  for (let current = 0, previous = ring.length - 1; current < ring.length; previous = current++) {
    const left = ring[previous];
    const right = ring[current];
    if (pointOnSegment(point, left, right)) return true;
    const crosses = (right[1] > point[1]) !== (left[1] > point[1])
      && point[0] < ((left[0] - right[0]) * (point[1] - right[1])) / (left[1] - right[1]) + right[0];
    if (crosses) inside = !inside;
  }
  return inside;
}

function pointInPolygon(point, polygon) {
  if (!polygon.length || !pointInRing(point, polygon[0])) return false;
  return polygon.slice(1).every((hole) => !pointInRing(point, hole));
}

export function inGeoBoundary(station, boundary) {
  if (!boundary || !Number.isFinite(station.lat) || !Number.isFinite(station.lon)) return true;
  const point = [station.lon, station.lat];
  if (boundary.type === "Polygon") return pointInPolygon(point, boundary.coordinates || []);
  if (boundary.type === "MultiPolygon") {
    return (boundary.coordinates || []).some((polygon) => pointInPolygon(point, polygon));
  }
  return true;
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

function stationAddressKey(value) {
  const normalized = String(value || "")
    .toLocaleLowerCase("ru-RU")
    .replace(/^россия\s*,?\s*/u, "")
    .replace(/[^a-zа-я0-9]/giu, "");
  return new Set(["", "адрес", "адреснеуказан"]).has(normalized) ? "" : normalized;
}

function addressesOf(station) {
  return [station.address, ...(station.addressAliases || [])].filter(Boolean);
}

function namesOf(station) {
  return [station.name, ...(station.nameAliases || [])].filter(Boolean);
}

function preferredStationName(names) {
  const unique = [...new Set(names.map((name) => String(name).trim()).filter(Boolean))];
  const brandLike = unique.filter((name) => !/(?:^|\s)(?:азс|агзс|агнкс)(?:\s|$)|№\s*\d/iu.test(name));
  return (brandLike.length ? brandLike : unique)
    .sort((left, right) => right.length - left.length || left.localeCompare(right, "ru"))[0];
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

function isCoLocatedDuplicate(left, right) {
  if (![left.lat, left.lon, right.lat, right.lon].every(Number.isFinite)) return false;
  if (distanceMeters(left, right) > 5) return false;
  const leftAddresses = new Set(addressesOf(left).map(stationAddressKey).filter(Boolean));
  return addressesOf(right).map(stationAddressKey).some((address) => address && leftAddresses.has(address));
}

function isSameStation(left, right) {
  if (left.yandexOrgId && right.yandexOrgId === left.yandexOrgId) return true;
  if (sameProviderIdentity(left, right)) return true;
  // Distinct records from one provider stay separate unless the provider has
  // duplicated the exact same physical point and address under multiple IDs.
  if (sharesProvider(left, right)) return isCoLocatedDuplicate(left, right);
  if (![left.lat, left.lon, right.lat, right.lon].every(Number.isFinite)) return false;
  const distance = distanceMeters(left, right);
  const leftNames = new Set(namesOf(left).map(stationNameKey).filter(Boolean));
  const sameName = namesOf(right).map(stationNameKey).some((name) => name && leftNames.has(name));
  const leftAddresses = new Set(addressesOf(left).map(stationAddressKey).filter(Boolean));
  const sameAddress = addressesOf(right).map(stationAddressKey).some((address) => address && leftAddresses.has(address));
  // Provider coordinates commonly differ by a few metres. Beyond that tolerance,
  // require identity evidence so neighbouring stations are not silently merged.
  return distance <= 15
    || (distance <= 40 && (sameName || sameAddress))
    || (distance <= 150 && sameName && sameAddress);
}

function isCorroboratedOrphanDuplicate(left, right) {
  if (!sharesProvider(left, right)) return false;
  const leftSources = new Set(refsOf(left).map((ref) => ref.source));
  const rightSources = new Set(refsOf(right).map((ref) => ref.source));
  if (leftSources.size < 2 && rightSources.size < 2) return false;
  if (![left.lat, left.lon, right.lat, right.lon].every(Number.isFinite)) return false;
  if (distanceMeters(left, right) > 40) return false;
  const leftNames = new Set(namesOf(left).map(stationNameKey).filter(Boolean));
  return namesOf(right).map(stationNameKey).some((name) => name && leftNames.has(name));
}

function aggregateStatuses(values) {
  const known = values.filter((value) => value && value !== "no_data");
  if (!known.length) return "no_data";
  const unique = new Set(known);
  return unique.size === 1 ? known[0] : "maybe_available";
}

function reliableAggregateStatus(values) {
  const known = values.filter((value) => value && value !== "no_data");
  const status = aggregateStatuses(known);
  return status === "available" && known.length < 2 ? "maybe_available" : status;
}

function latestObservedAt(values) {
  const timestamps = values.filter((value) => Number.isFinite(Date.parse(value)));
  return timestamps.length ? new Date(Math.max(...timestamps.map(Date.parse))).toISOString() : null;
}

function maximumNumber(values) {
  const numbers = values.filter((value) => value != null && Number.isFinite(Number(value))).map(Number);
  return numbers.length ? Math.max(...numbers) : null;
}

function mergeEvidence(left = {}, right = {}) {
  const fuels = new Set([...Object.keys(left.fuelStatus || {}), ...Object.keys(right.fuelStatus || {})]);
  const leftTime = Date.parse(left.observedAt);
  const rightTime = Date.parse(right.observedAt);
  const hasChronology = Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime;
  const newer = hasChronology && leftTime > rightTime ? left : right;
  const older = newer === right ? left : right;
  return {
    ...(hasChronology ? older : left),
    ...(hasChronology ? newer : right),
    overallStatus: hasChronology
      ? newer.overallStatus || older.overallStatus || "no_data"
      : aggregateStatuses([left.overallStatus, right.overallStatus]),
    fuelStatus: Object.fromEntries([...fuels].map((fuel) => [
      fuel,
      hasChronology
        ? newer.fuelStatus?.[fuel] || older.fuelStatus?.[fuel] || "no_data"
        : aggregateStatuses([left.fuelStatus?.[fuel], right.fuelStatus?.[fuel]].filter(Boolean)),
    ])),
    observedAt: latestObservedAt([left.observedAt, right.observedAt]),
    operationsCount: maximumNumber([left.operationsCount, right.operationsCount]),
    confirmations: maximumNumber([left.confirmations, right.confirmations]),
    confidence: maximumNumber([left.confidence, right.confidence]),
  };
}

function mergeEvidenceBySource(left = {}, right = {}) {
  const sources = new Set([...Object.keys(left), ...Object.keys(right)]);
  return Object.fromEntries([...sources].map((source) => [source, mergeEvidence(left[source], right[source])]));
}

function recomputeAvailability(station) {
  const evidence = Object.values(station.availabilityBySource || {});
  station.overallStatus = reliableAggregateStatus(evidence.map((item) => item.overallStatus));
  const fuels = new Set(evidence.flatMap((item) => Object.keys(item.fuelStatus || {})));
  station.fuelStatus = Object.fromEntries([...fuels].map((fuel) => [
    fuel,
    reliableAggregateStatus(evidence.map((item) => item.fuelStatus?.[fuel]).filter(Boolean)),
  ]));
  const observed = evidence.map((item) => item.observedAt).filter((value) => Number.isFinite(Date.parse(value)));
  station.lastTransactionAt = observed.length
    ? new Date(Math.max(...observed.map(Date.parse))).toISOString()
    : station.lastTransactionAt;
  return station;
}

function mergeStationInto(match, station) {
    const refs = [...refsOf(match), ...refsOf(station)];
    match.sourceRefs = [...new Map(refs.map((ref) => [refKey(ref), ref])).values()];
    match.addressAliases = [...new Set([...addressesOf(match), ...addressesOf(station)])];
    match.nameAliases = [...new Set([...namesOf(match), ...namesOf(station)])];
    match.name = preferredStationName(match.nameAliases) || match.name;
    const matchPriceTime = Date.parse(match.priceUpdatedAt);
    const stationPriceTime = Date.parse(station.priceUpdatedAt);
    const incomingPrices = station.prices || {};
    const hasIncomingPrices = Object.keys(incomingPrices).length > 0;
    const incomingIsNewer = hasIncomingPrices && Number.isFinite(stationPriceTime)
      && (!Number.isFinite(matchPriceTime) || stationPriceTime >= matchPriceTime);
    match.prices = incomingIsNewer
      ? { ...(match.prices || {}), ...incomingPrices }
      : { ...incomingPrices, ...(match.prices || {}) };
    match.links = { ...(match.links || {}), ...(station.links || {}) };
    match.availabilityBySource = mergeEvidenceBySource(match.availabilityBySource, station.availabilityBySource);
    match.yandexOrgId ||= station.yandexOrgId;
    if (hasIncomingPrices && (incomingIsNewer || !match.priceUpdatedAt)) match.priceUpdatedAt = station.priceUpdatedAt || match.priceUpdatedAt;
}

export function mergeStations(stations) {
  const merged = [];
  for (const station of stations) {
    const match = merged.find((candidate) => isSameStation(station, candidate));
    if (!match) {
      merged.push(structuredClone(station));
      continue;
    }
    mergeStationInto(match, station);
  }

  for (let left = 0; left < merged.length; left += 1) {
    for (let right = merged.length - 1; right > left; right -= 1) {
      if (!isCorroboratedOrphanDuplicate(merged[left], merged[right])) continue;
      mergeStationInto(merged[left], merged[right]);
      merged.splice(right, 1);
    }
  }
  return merged.map(recomputeAvailability);
}

export function summarizeStations(stations) {
  const statuses = { available: 0, maybe_available: 0, not_available: 0, no_data: 0 };
  const fuels = {};
  const brands = new Map();
  const timestamps = [];
  const now = Date.now();
  let withPrices = 0;
  for (const station of stations) {
    statuses[station.overallStatus] = (statuses[station.overallStatus] || 0) + 1;
    for (const [fuel, status] of Object.entries(station.fuelStatus || {})) {
      fuels[fuel] ||= { available: 0, maybe_available: 0, not_available: 0, no_data: 0, total: 0 };
      fuels[fuel][status] = (fuels[fuel][status] || 0) + 1;
      fuels[fuel].total += 1;
    }
    const displayName = String(station.name || "АЗС").trim() || "АЗС";
    const brandKey = displayName.toLocaleLowerCase("ru-RU");
    const brand = brands.get(brandKey) || { name: displayName, count: 0 };
    brand.count += 1;
    brands.set(brandKey, brand);
    const timestamp = Date.parse(station.lastTransactionAt);
    if (Number.isFinite(timestamp) && timestamp <= now + 5 * 60_000) timestamps.push(timestamp);
    if (Object.values(station.prices || {}).some((price) => Number.isFinite(Number(price?.value)) && Number(price.value) > 0)) withPrices += 1;
  }
  return {
    total: stations.length,
    statuses,
    fuels,
    brands: [...brands.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "ru")).slice(0, 10),
    withPrices,
    freshness: {
      withTimestamp: timestamps.length,
      recent24h: timestamps.filter((value) => value <= now + 5 * 60_000 && now - value <= 24 * 60 * 60_000).length,
      recent72h: timestamps.filter((value) => value <= now + 5 * 60_000 && now - value <= 72 * 60 * 60_000).length,
      latestAt: timestamps.length ? new Date(Math.max(...timestamps)).toISOString() : null,
    },
  };
}
