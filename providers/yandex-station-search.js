import { config } from "../config.js";
import { readFreshCache, writeBoundedCache } from "../domain/bounded-cache.js";
import { fetchYandexStationPrices } from "./yandex.js";
import { parseYandexPriceDocument, parseYandexStateItems } from "./yandex-price-document.js";

const cache = new Map();
const requests = new Map();
const genericNames = new Set(["азс", "агзс", "агнкс", "заправка", "автозаправка", "станция", "ооо", "сеть"]);

function nameWords(name) {
  return String(name || "").toLocaleLowerCase("ru-RU").replaceAll("ё", "е")
    .match(/[a-zа-я]+/gu)?.filter((word) => !genericNames.has(word)) || [];
}

function distanceMeters(station, coordinates) {
  const radians = (value) => value * Math.PI / 180;
  const [lon, lat] = coordinates;
  const a = Math.sin(radians(lat - station.lat) / 2) ** 2
    + Math.cos(radians(station.lat)) * Math.cos(radians(lat)) * Math.sin(radians(lon - station.lon) / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// A nearby station is not automatically the same station. Require a unique
// match, using the known organization ID or both name and coordinates.
export function matchYandexStation(items, station) {
  const wanted = nameWords(station.name);
  const matches = items.filter((item) => {
    if (!/^\d{1,20}$/.test(String(item.id || ""))) return false;
    if (!Array.isArray(item.coordinates) || item.coordinates.length !== 2 || !item.coordinates.every(Number.isFinite)) return false;
    const distance = distanceMeters(station, item.coordinates);
    if (distance > config.yandex.stationMatchMaxDistanceMeters) return false;
    if (station.yandexOrgId) return String(item.id) === station.yandexOrgId;
    if (!item.fuelInfo && !(item.categories || []).some((category) => /АЗС|АГЗС|АГНКС|заправ/iu.test(category.name || ""))) return false;
    if (!wanted.length) return distance <= config.yandex.unnamedStationMatchMaxDistanceMeters;
    const actual = nameWords(item.title);
    const [shorter, longer] = wanted.length <= actual.length ? [wanted, actual] : [actual, wanted];
    return shorter.length > 0 && shorter.every((word) => longer.includes(word));
  });
  const unique = [...new Map(matches.map((item) => [String(item.id), item])).values()];
  return unique.length === 1 ? unique[0] : null;
}

export function clearSelectedStationPriceCache() {
  cache.clear();
}

async function searchPrices(station, organizationFailure = null) {
  const url = new URL("https://yandex.ru/maps/");
  url.search = new URLSearchParams({
    ll: `${station.lon},${station.lat}`, spn: "0.01,0.01", z: "17", text: "АЗС", lang: "ru_RU",
  });
  const response = await fetch(url, {
    signal: AbortSignal.timeout(config.yandex.timeoutMs),
    headers: { "User-Agent": "Mozilla/5.0 BenzAI/0.1", "Accept-Language": "ru-RU,ru;q=0.9" },
  });
  if (!response.ok) throw Object.assign(new Error("Яндекс Карты временно недоступны"), { code: "YANDEX_HTTP_ERROR" });
  const html = await response.text();
  if (/showcaptcha|SmartCaptcha/i.test(html) || /showcaptcha/i.test(response.url)) {
    throw Object.assign(new Error("Яндекс ограничил автоматическую проверку цен. Повторите позже."), { code: "YANDEX_ACCESS_CHECK" });
  }
  const state = parseYandexStateItems(html);
  if (!state.found || state.invalid) {
    throw Object.assign(new Error("Не удалось прочитать результаты поиска АЗС в Яндекс Картах. Повторите позже."), { code: "YANDEX_SEARCH_UNVERIFIED" });
  }
  const item = matchYandexStation(state.items, station);
  if (!item) throw Object.assign(new Error("Не удалось однозначно сопоставить эту АЗС с карточкой Яндекса. Цены соседних станций не используются."), { code: "YANDEX_STATION_NOT_MATCHED" });
  const id = String(item.id);
  const parsed = parseYandexPriceDocument(html, id);
  if (parsed.status !== "available") {
    if (organizationFailure) throw organizationFailure;
    return fetchYandexStationPrices(id);
  }
  return {
    yandexOrgId: id,
    prices: parsed.prices,
    priceUpdatedAt: parsed.updatedAt,
    yandexCheckedAt: new Date().toISOString(),
    priceStatus: parsed.status,
    stationClosed: parsed.closed,
  };
}

// Selected-station discovery is independent of T-Bank and region aggregation.
// Only successful price checks are cached; failures can be retried on reopen.
export async function fetchSelectedStationPrices(station) {
  if (!config.yandex.enabled) throw new Error("Проверка цен Яндекса отключена");
  const canSearch = Number.isFinite(station.lat) && Number.isFinite(station.lon) && Boolean(station.name);
  if (!canSearch) return fetchYandexStationPrices(station.yandexOrgId);
  const key = JSON.stringify([station.yandexOrgId || "", station.lat, station.lon, station.name]);
  const saved = readFreshCache(cache, key, config.yandex.cacheTtlMs);
  if (saved) return saved;
  if (requests.has(key)) return requests.get(key);
  if (requests.size >= config.yandex.concurrency) throw new Error("Проверка цен занята. Повторите через несколько секунд");
  const request = (async () => {
    let organizationFailure = null;
    if (station.yandexOrgId) {
      try { return await fetchYandexStationPrices(station.yandexOrgId); }
      catch (error) {
        // A valid organization page may omit fuelInfo for the hosting IP.
        // The public search page is an independent representation of that ID.
        if (error.code !== "YANDEX_PRICES_UNVERIFIED") throw error;
        organizationFailure = error;
      }
    }
    return searchPrices(station, organizationFailure);
  })().then((result) => {
    if (Object.keys(result.prices || {}).length) writeBoundedCache(cache, key, result, config.yandex.cacheMaxEntries);
    return result;
  }).finally(() => requests.delete(key));
  requests.set(key, request);
  return request;
}
