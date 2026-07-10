import { config } from "../config.js";

const cache = new Map();
let queue = Promise.resolve();
let lastRequestAt = 0;

export function clearGeocoderCache() {
  cache.clear();
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function schedule(task) {
  const scheduled = queue.then(async () => {
    await wait(Math.max(0, 1_000 - (Date.now() - lastRequestAt)));
    try { return await task(); }
    finally { lastRequestAt = Date.now(); }
  });
  queue = scheduled.catch(() => {});
  return scheduled;
}

export async function geocodeLocation(rawQuery) {
  const query = String(rawQuery || "").trim();
  if (query.length < 2 || query.length > 100) throw new Error("Введите город или область — от 2 до 100 символов");
  const key = query.toLocaleLowerCase("ru-RU");
  const saved = cache.get(key);
  if (saved && Date.now() - saved.createdAt < config.geocoder.cacheTtlMs) return saved.value;

  const place = await schedule(async () => {
    const url = new URL(config.geocoder.url);
    url.search = new URLSearchParams({
      q: query,
      format: "jsonv2",
      limit: "5",
      countrycodes: "ru",
      addressdetails: "1",
      "accept-language": "ru",
      layer: "address",
    });
    const response = await fetch(url, {
      signal: AbortSignal.timeout(config.geocoder.timeoutMs),
      headers: { Accept: "application/json", "User-Agent": config.geocoder.userAgent },
    });
    if (!response.ok) throw new Error(`Сервис поиска территорий вернул HTTP ${response.status}`);
    const results = await response.json();
    const found = Array.isArray(results) && results.find((item) => Array.isArray(item.boundingbox) && item.boundingbox.length === 4);
    if (!found) throw new Error(`Не удалось найти «${query}» в России`);
    const [minLat, maxLat, minLon, maxLon] = found.boundingbox.map(Number);
    return {
      name: found.name || found.display_name,
      displayName: found.display_name,
      type: found.addresstype || found.type,
      lat: Number(found.lat),
      lon: Number(found.lon),
      bbox: { minLat, maxLat, minLon, maxLon },
      attribution: found.licence || "© OpenStreetMap contributors",
    };
  });
  cache.set(key, { createdAt: Date.now(), value: place });
  return place;
}
