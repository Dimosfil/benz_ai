import { config } from "../config.js";
import { normalizeLocationQueryWithLlm } from "./location-query-normalizer.js";

const cache = new Map();
const inflight = new Map();
let queue = Promise.resolve();
let lastRequestAt = 0;
let cacheGeneration = 0;
let queuedRequests = 0;

export function clearGeocoderCache() {
  cacheGeneration += 1;
  cache.clear();
  inflight.clear();
}

function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function schedule(task) {
  if (queuedRequests >= config.geocoder.queueMax) {
    const error = new Error("Сервис поиска территорий временно перегружен");
    error.code = "GEOCODER_BUSY";
    return Promise.reject(error);
  }
  queuedRequests += 1;
  const scheduled = queue.then(async () => {
    await wait(Math.max(0, 1_000 - (Date.now() - lastRequestAt)));
    try { return await task(); }
    finally { lastRequestAt = Date.now(); }
  });
  queue = scheduled.catch(() => {});
  return scheduled.finally(() => { queuedRequests = Math.max(0, queuedRequests - 1); });
}

function settlementSpellingCandidate(query) {
  const parts = query.split(/(\s+|,\s*)/);
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    if (!/[А-ЯЁа-яё]/u.test(parts[index])) continue;
    if (!/(?:ов|ев|ин)а$/iu.test(parts[index])) continue;
    parts[index] = `${parts[index].slice(0, -1)}${/[А-ЯЁ]/u.test(parts[index].at(-1)) ? "О" : "о"}`;
    return parts.join("");
  }
  return null;
}

export function geocoderQueryCandidates(rawQuery) {
  const query = String(rawQuery || "").trim();
  const corrected = settlementSpellingCandidate(query);
  return corrected && corrected !== query ? [query, corrected] : [query];
}

function normalizedPlaceName(value) {
  return String(value || "").toLocaleLowerCase("ru-RU").replace(/^\s*(?:село|пос[её]лок)\s+/u, "").trim();
}

function exactCandidateMatch(item, candidate) {
  const wanted = normalizedPlaceName(candidate.split(",", 1)[0]);
  const actual = normalizedPlaceName(item?.name);
  return (actual === wanted || wanted.endsWith(` ${actual}`)) && regionMatches(item, candidate);
}

function regionMatches(item, candidate) {
  const region = candidate.split(",").slice(1).join(" ").trim();
  if (!region) return true;
  const haystack = String(item?.display_name || "").toLocaleLowerCase("ru-RU").replace(/ё/g, "е");
  const hints = region.toLocaleLowerCase("ru-RU").replace(/ё/g, "е").match(/[a-zа-я0-9]{3,}/giu) || [];
  const generic = new Set(["область", "район", "край", "республика", "россия"]);
  return hints.filter((word) => !generic.has(word)).every((word) => haystack.includes(word));
}

function exactPlaceNameMatch(item, placeName) {
  return normalizedPlaceName(item?.name) === normalizedPlaceName(placeName);
}

async function requestPlaces(query) {
  return schedule(async () => {
    const url = new URL(config.geocoder.url);
    url.search = new URLSearchParams({
      q: query,
      format: "jsonv2",
      limit: "5",
      countrycodes: "ru",
      addressdetails: "1",
      "accept-language": "ru",
      layer: "address",
      polygon_geojson: "1",
      polygon_threshold: "0.0005",
    });
    const response = await fetch(url, {
      signal: AbortSignal.timeout(config.geocoder.timeoutMs),
      headers: { Accept: "application/json", "User-Agent": config.geocoder.userAgent },
    });
    if (!response.ok) throw new Error(`Сервис поиска территорий вернул HTTP ${response.status}`);
    const results = await response.json();
    return Array.isArray(results) ? results.filter((item) => {
      if (!Array.isArray(item.boundingbox) || item.boundingbox.length !== 4) return false;
      const [minLat, maxLat, minLon, maxLon] = item.boundingbox.map(Number);
      return [minLat, maxLat, minLon, maxLon, Number(item.lat), Number(item.lon)].every(Number.isFinite)
        && minLat >= -90 && maxLat <= 90 && minLon >= -180 && maxLon <= 180
        && minLat < maxLat && minLon < maxLon;
    }) : [];
  });
}

async function geocodeUncached(query, key, generation) {
  let found;
  for (const candidate of geocoderQueryCandidates(query)) {
    const results = await requestPlaces(candidate);
    const exact = results.find((item) => exactCandidateMatch(item, candidate));
    if (exact) { found = exact; break; }
    found ||= results[0];
  }
  const hasExactMatch = found && geocoderQueryCandidates(query).some((candidate) => exactCandidateMatch(found, candidate));
  if (!hasExactMatch) {
    const normalized = await normalizeLocationQueryWithLlm(query);
    if (normalized) {
      const results = await requestPlaces(normalized.query);
      const verified = results.find((item) => exactPlaceNameMatch(item, normalized.placeName) && regionMatches(item, normalized.query));
      if (verified) found = verified;
    }
  }
  if (!found) throw new Error(`Не удалось найти «${query}» в России`);

  const [minLat, maxLat, minLon, maxLon] = found.boundingbox.map(Number);
  const place = {
    name: found.name || found.display_name,
    displayName: found.display_name,
    type: found.addresstype || found.type,
    lat: Number(found.lat),
    lon: Number(found.lon),
    bbox: { minLat, maxLat, minLon, maxLon },
    attribution: found.licence || "© OpenStreetMap contributors",
    boundary: ["Polygon", "MultiPolygon"].includes(found.geojson?.type) ? found.geojson : null,
  };
  if (generation === cacheGeneration) {
    cache.delete(key);
    cache.set(key, { createdAt: Date.now(), value: place });
    while (cache.size > config.geocoder.cacheMaxEntries) cache.delete(cache.keys().next().value);
  }
  return place;
}

export function geocodeLocation(rawQuery) {
  const query = String(rawQuery || "").trim();
  if (query.length < 2 || query.length > 100) return Promise.reject(new Error("Введите город или область — от 2 до 100 символов"));
  const key = query.toLocaleLowerCase("ru-RU");
  const saved = cache.get(key);
  if (saved && Date.now() - saved.createdAt < config.geocoder.cacheTtlMs) return Promise.resolve(saved.value);
  if (inflight.has(key)) return inflight.get(key);
  const pending = geocodeUncached(query, key, cacheGeneration);
  const shared = pending.finally(() => {
    if (inflight.get(key) === shared) inflight.delete(key);
  });
  inflight.set(key, shared);
  return shared;
}
