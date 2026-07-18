import { config } from "../config.js";
import { readFreshCache, writeBoundedCache } from "../domain/bounded-cache.js";
import { normalizeFuelName } from "../domain/stations.js";

const cache = new Map();

export function clearYandexCache() {
  cache.clear();
}

function decodeEmbeddedHtml(value) {
  return value
    .replaceAll("\\u003c", "<")
    .replaceAll("\\u003e", ">")
    .replaceAll("\\u0026", "&")
    .replaceAll('\\"', '"')
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&");
}

export function parseYandexFuelPrices(rawHtml) {
  const html = decodeEmbeddedHtml(rawHtml);
  const pattern = /search-fuel-info-view__name"[^>]*>(?<fuel>[^<]+)<\/div><div class="search-fuel-info-view__value"[^>]*>(?<price>[^<]*)<\/div>/g;
  const prices = {};
  for (const match of html.matchAll(pattern)) {
    const value = Number(match.groups.price.replace(",", ".").replace(/[^0-9.]/g, ""));
    if (Number.isFinite(value) && value > 0) prices[normalizeFuelName(match.groups.fuel)] = { value, currency: "RUB", source: "yandex" };
  }
  const updated = html.match(/Обновлено (?<date>[^<\\]{1,80}) по данным/)?.groups?.date ?? null;
  return { prices, updatedAt: updated };
}

export function isYandexVerificationCandidate(station) {
  const hasPositiveSignal = Object.values(station.availabilityBySource || {}).some((evidence) => (
    evidence?.overallStatus === "available"
    || Object.values(evidence?.fuelStatus || {}).includes("available")
  ));
  return Boolean(station.yandexOrgId) && (station.overallStatus === "available" || hasPositiveSignal);
}

async function checkStation(station) {
  const saved = readFreshCache(cache, station.yandexOrgId, config.yandex.cacheTtlMs);
  if (saved) return applyYandexResult(station, saved);
  const response = await fetch(`https://yandex.ru/maps/org/${station.yandexOrgId}/`, {
    signal: AbortSignal.timeout(config.yandex.timeoutMs),
    headers: { "User-Agent": "Mozilla/5.0 BenzAI/0.1", "Accept-Language": "ru-RU,ru;q=0.9" },
  });
  if (!response.ok) throw new Error(`Яндекс Карты вернули HTTP ${response.status}`);
  const parsed = parseYandexFuelPrices(await response.text());
  const value = {
    prices: parsed.prices,
    priceUpdatedAt: parsed.updatedAt,
    yandexCheckedAt: new Date().toISOString(),
  };
  writeBoundedCache(cache, station.yandexOrgId, value, config.yandex.cacheMaxEntries);
  return applyYandexResult(station, value);
}

function applyYandexResult(station, value) {
  const refs = [...(station.sourceRefs || []), { source: "yandex", externalId: station.yandexOrgId }];
  return {
    ...station,
    ...value,
    prices: { ...(station.prices || {}), ...(value.prices || {}) },
    priceUpdatedAt: value.priceUpdatedAt || station.priceUpdatedAt || null,
    sourceRefs: [...new Map(refs.map((ref) => [`${ref.source}:${ref.externalId}`, ref])).values()],
  };
}

export async function enrichYandexPrices(stations) {
  if (!config.yandex.enabled) {
    return { stations, eligible: 0, attempted: 0, checked: 0, warning: "Проверка Яндекс Карт отключена через ENABLE_YANDEX_PRICES=0." };
  }
  const eligible = stations.filter(isYandexVerificationCandidate);
  const candidates = eligible.slice(0, config.yandex.limit);
  const output = [...stations];
  const errors = [];
  let cursor = 0;
  let checked = 0;
  async function worker() {
    while (cursor < candidates.length) {
      const candidate = candidates[cursor++];
      const index = output.indexOf(candidate);
      try {
        output[index] = await checkStation(candidate);
        checked += 1;
      } catch (error) {
        errors.push(`${candidate.name}: ${error.message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(config.yandex.concurrency, candidates.length) }, worker));
  const warnings = [];
  if (eligible.length > candidates.length) warnings.push(`Яндекс проверен только для первых ${candidates.length} АЗС с положительным сигналом наличия.`);
  if (errors.length) warnings.push(`Не удалось проверить Яндекс для ${errors.length} АЗС.`);
  return {
    stations: output,
    eligible: eligible.length,
    attempted: candidates.length,
    checked,
    warning: warnings.join(" ") || null,
  };
}
