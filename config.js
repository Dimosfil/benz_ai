function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function enabledByDefault(value) {
  return !/^(0|false|no)$/i.test(String(value || ""));
}

function disabledByDefault(value) {
  return /^(1|true|yes)$/i.test(String(value || ""));
}

const yandexLimit = Number(process.env.YANDEX_PRICE_LIMIT || 0);

export const config = Object.freeze({
  port: positiveInteger(process.env.PORT, 3000),
  resultCacheTtlMs: 2 * 60_000,
  sourceUserAgent: process.env.SOURCE_USER_AGENT || "BenzAI/0.1 local fuel aggregator",
  geocoder: Object.freeze({
    url: process.env.GEOCODER_API_URL || "https://nominatim.openstreetmap.org/search",
    userAgent: process.env.GEOCODER_USER_AGENT || "BenzAI/0.1 local fuel search",
    cacheTtlMs: 24 * 60 * 60_000,
    timeoutMs: 15_000,
  }),
  tbank: Object.freeze({
    url: process.env.TBANK_API_URL || "https://toplivo.tbank.ru/api/v1/stations",
    timeoutMs: 15_000,
    pageLimit: 300,
    maxRequests: 40,
    maxSplitDepth: 4,
  }),
  alfa: Object.freeze({
    url: process.env.ALFA_AZS_API_URL || "https://alfabank.ru/api/v1/azs-stations/public/stations",
    pageUrl: process.env.ALFA_AZS_PAGE_URL || "https://alfabank.ru/",
    userAgent: process.env.ALFA_AZS_USER_AGENT || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/138 Safari/537.36",
    cacheTtlMs: positiveInteger(process.env.ALFA_AZS_CACHE_TTL_MS, 60_000),
    timeoutMs: positiveInteger(process.env.ALFA_AZS_TIMEOUT_MS, 30_000),
    zoom: positiveInteger(process.env.ALFA_AZS_ZOOM, 14),
  }),
  benzup: Object.freeze({
    url: process.env.BENZUP_API_URL || "https://api.omt-consult.ru/v2/stations",
    token: process.env.BENZUP_API_TOKEN || "",
    timeoutMs: 30_000,
  }),
  sber: Object.freeze({
    refreshMs: positiveInteger(process.env.SBER_REFRESH_MS, 60_000),
    activeAreaTtlMs: positiveInteger(process.env.SBER_ACTIVE_AREA_TTL_MS, 15 * 60_000),
    maxActiveAreas: positiveInteger(process.env.SBER_MAX_ACTIVE_AREAS, 10),
    browserIdleMs: positiveInteger(process.env.SBER_BROWSER_IDLE_MS, 30_000),
  }),
  yandex: Object.freeze({
    enabled: enabledByDefault(process.env.ENABLE_YANDEX_PRICES),
    limit: Number.isFinite(yandexLimit) && yandexLimit > 0 ? Math.floor(yandexLimit) : Infinity,
    cacheTtlMs: 15 * 60_000,
    timeoutMs: 15_000,
    concurrency: 3,
  }),
  gdebenz: Object.freeze({
    url: process.env.GDEBENZ_API_URL || "https://gdebenz.ru/api/nearby",
    cacheTtlMs: 60_000,
    timeoutMs: 20_000,
    maxRadiusKm: 30,
  }),
  multigo: Object.freeze({
    url: process.env.MULTIGO_API_URL || "https://multigo.ru/api/9/near/list",
    cacheTtlMs: 60_000,
    timeoutMs: 20_000,
    limit: 100,
  }),
  deepseek: Object.freeze({
    baseUrl: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
    apiKey: process.env.DEEPSEEK_API_KEY || "",
    model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
    timeoutMs: positiveInteger(process.env.DEEPSEEK_TIMEOUT_MS, 60_000),
  }),
  telegram: Object.freeze({
    enabled: disabledByDefault(process.env.TELEGRAM_POLLING_ENABLED),
    token: process.env.TELEGRAM_BOT_TOKEN || "",
    apiBaseUrl: process.env.TELEGRAM_API_BASE_URL || "https://api.telegram.org",
    longPollSeconds: 20,
    retryDelayMs: 3_000,
  }),
});
