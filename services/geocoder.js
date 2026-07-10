import { config } from "../config.js";

const cache = new Map();
let queue = Promise.resolve();
let lastRequestAt = 0;

export function clearGeocoderCache() { cache.clear(); }

function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function schedule(task) {
  const scheduled = queue.then(async () => {
    await wait(Math.max(0, 1_000 - (Date.now() - lastRequestAt)));
    try { return await task(); }
    finally { lastRequestAt = Date.now(); }
  });
  queue = scheduled.catch(() => {});
  return scheduled;
}

function settlementSpellingCandidate(query) {
  const parts = query.split(/(\s+|,\s*)/);
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    if (!/[А-ЯЁа-яё]/u.test(parts[index])) continue;
    if (!/(?:ов|ев|ин)а$/iu.test(parts[index])) return null;
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
  const wanted = normalizedPlaceName(candidate.split(/[\s,]+/u).filter(Boolean).at(-1));
  return normalizedPlaceName(item?.name) === wanted;
}

async function requestPlaces(query) {
  return schedule(async () => {
    const url = new URL(config.geocoder.url);
    url.search = new URLSearchParams({ q: query, format: "jsonv2", limit: "5", countrycodes: "ru", addressdetails: "1", "accept-language": "ru", layer: "address" });
    const response = await fetch(url, {
      signal: AbortSignal.timeout(config.geocoder.timeoutMs),
      headers: { Accept: "application/json", "User-Agent": config.geocoder.userAgent },
    });
    if (!response.ok) throw new Error(`Сервис поиска территорий вернул HTTP ${response.status}`);
    const results = await response.json();
    return Array.isArray(results) ? results.filter((item) => Array.isArray(item.boundingbox) && item.boundingbox.length === 4) : [];
  });
}

export async function geocodeLocation(rawQuery) {
  const query = String(rawQuery || "").trim();
  if (query.length < 2 || query.length > 100) throw new Error("Введите город или область — от 2 до 100 символов");
  const key = query.toLocaleLowerCase("ru-RU");
  const saved = cache.get(key);
  if (saved && Date.now() - saved.createdAt < config.geocoder.cacheTtlMs) return saved.value;

  let found;
  for (const candidate of geocoderQueryCandidates(query)) {
    const results = await requestPlaces(candidate);
    const exact = results.find((item) => exactCandidateMatch(item, candidate));
    if (exact) { found = exact; break; }
    found ||= results[0];
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
  };
  cache.set(key, { createdAt: Date.now(), value: place });
  return place;
}
