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

function relativeObservationTime(text, now) {
  if (/Обновлено\s+только что/iu.test(text)) return new Date(now).toISOString();
  const match = text.match(/Обновлено\s+(?<count>\d+)\s*(?<unit>мин(?:ут[уы]?)?|ч(?:ас(?:а|ов)?)?|дн(?:я|ей)?)[^<]*/iu);
  if (!match) return null;
  const count = Number(match.groups.count);
  const unit = match.groups.unit.toLocaleLowerCase("ru-RU");
  const multiplier = unit.startsWith("мин") ? 60_000 : unit.startsWith("ч") ? 60 * 60_000 : 24 * 60 * 60_000;
  return new Date(now - count * multiplier).toISOString();
}

function queueFromTitle(title) {
  const label = title.split("·").map((part) => part.trim()).find((part) => /очеред/iu.test(part)) || null;
  if (!label) return { queueStatus: null, queueLabel: null };
  const normalized = label.toLocaleLowerCase("ru-RU");
  const queueStatus = /без очеред/iu.test(normalized)
    ? "none"
    : /больш/iu.test(normalized)
      ? "high"
      : /средн/iu.test(normalized)
        ? "medium"
        : /небольш|мал/iu.test(normalized)
          ? "low"
          : "unknown";
  return { queueStatus, queueLabel: label };
}

export function parseYandexFuelAvailability(rawHtml, now = Date.now()) {
  const html = decodeEmbeddedHtml(rawHtml);
  const titleMatch = html.match(/gas-station-fuel-card-view__title"[^>]*>(?<title>[^<]+)<\/div>/u);
  if (!titleMatch) return null;
  const start = titleMatch.index;
  const end = html.indexOf('orgpage-header-view__moved', start);
  const card = html.slice(start, end > start ? end : start + 8_000);
  const title = titleMatch.groups.title.trim();
  const cardStatus = /топливо в наличии/iu.test(title)
    ? "available"
    : /топлив[^<]{0,30}(?:нет|отсутств)/iu.test(title)
      ? "not_available"
      : "no_data";
  const fuelStatus = {};
  const chipPattern = /<span class="gas-station-fuel-card-view__chip(?<classes>(?:\s+_[^"\s]+)*)"[^>]*>[\s\S]*?gas-station-fuel-card-view__chip-label"[^>]*>(?<fuel>[^<]+)<\/span>/gu;
  for (const match of card.matchAll(chipPattern)) {
    const fuel = normalizeFuelName(match.groups.fuel);
    fuelStatus[fuel] = match.groups.classes.includes("_uncertain") ? "maybe_available" : cardStatus;
  }
  const confirmations = Number(card.match(/На основе\s+(?<count>\d+)\s+подтвержден/iu)?.groups?.count);
  const observedAt = relativeObservationTime(card, now);
  return {
    overallStatus: cardStatus,
    fuelStatus,
    observedAt,
    confirmations: Number.isFinite(confirmations) && confirmations > 0 ? confirmations : null,
    ...queueFromTitle(title),
    detail: title,
  };
}

export function isYandexVerificationCandidate(station) {
  return Boolean(station.yandexOrgId);
}

function requestSignal(signal) {
  const timeout = AbortSignal.timeout(config.yandex.timeoutMs);
  return signal && typeof AbortSignal.any === "function" ? AbortSignal.any([signal, timeout]) : timeout;
}

async function checkStation(station, signal) {
  const saved = readFreshCache(cache, station.yandexOrgId, config.yandex.cacheTtlMs);
  if (saved) return applyYandexResult(station, saved);
  const response = await fetch(`https://yandex.ru/maps/org/${station.yandexOrgId}/`, {
    signal: requestSignal(signal),
    headers: { "User-Agent": "Mozilla/5.0 BenzAI/0.1", "Accept-Language": "ru-RU,ru;q=0.9" },
  });
  if (!response.ok) throw new Error(`Яндекс Карты вернули HTTP ${response.status}`);
  const html = await response.text();
  const parsed = parseYandexFuelPrices(html);
  const availability = parseYandexFuelAvailability(html);
  const value = {
    prices: parsed.prices,
    priceUpdatedAt: parsed.updatedAt,
    availability,
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
    availabilityBySource: value.availability
      ? { ...(station.availabilityBySource || {}), yandex: value.availability }
      : station.availabilityBySource || {},
    sourceRefs: [...new Map(refs.map((ref) => [`${ref.source}:${ref.externalId}`, ref])).values()],
  };
}

export async function enrichYandexPrices(stations, { signal = null, timeoutMs = null } = {}) {
  if (!config.yandex.enabled) {
    return { stations, eligible: 0, attempted: 0, checked: 0, warning: "Проверка Яндекс Карт отключена через ENABLE_YANDEX_PRICES=0." };
  }
  const eligible = stations.filter(isYandexVerificationCandidate);
  const candidates = eligible.slice(0, config.yandex.limit);
  const output = [...stations];
  const errors = [];
  const timeoutSignal = Number.isFinite(timeoutMs) && timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : null;
  const budgetSignal = signal && timeoutSignal && typeof AbortSignal.any === "function"
    ? AbortSignal.any([signal, timeoutSignal])
    : signal || timeoutSignal;
  let cursor = 0;
  let attempted = 0;
  let checked = 0;
  async function worker() {
    while (cursor < candidates.length && !budgetSignal?.aborted) {
      const candidate = candidates[cursor++];
      attempted += 1;
      const index = output.indexOf(candidate);
      try {
        output[index] = await checkStation(candidate, budgetSignal);
        checked += 1;
      } catch (error) {
        if (budgetSignal?.aborted) break;
        errors.push(`${candidate.name}: ${error.message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(config.yandex.concurrency, candidates.length) }, worker));
  const warnings = [];
  if (eligible.length > candidates.length) warnings.push(`Яндекс проверен только для первых ${candidates.length} АЗС с доступной карточкой.`);
  if (budgetSignal?.aborted) warnings.push(`Проверка Яндекс Карт остановлена: проверено ${checked} из ${candidates.length} АЗС, чтобы не задерживать сводку.`);
  if (errors.length) warnings.push(`Не удалось проверить Яндекс для ${errors.length} АЗС.`);
  return {
    stations: output,
    eligible: eligible.length,
    attempted,
    checked,
    skipped: Boolean(budgetSignal?.aborted) || attempted < candidates.length,
    warning: warnings.join(" ") || null,
  };
}
