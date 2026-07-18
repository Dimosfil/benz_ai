import { createHmac, timingSafeEqual } from "node:crypto";
import pg from "pg";

const { Pool } = pg;
const EVENT_TYPES = new Set(["page_view", "search", "telegram_command", "telegram_search"]);
const BOT_USER_AGENT = /bot|crawler|spider|slurp|bingpreview|facebookexternalhit|headless|python-requests|curl|wget/i;

export class AnalyticsService {
  constructor(options = {}) {
    this.databaseUrl = String(options.databaseUrl || "").trim();
    this.hashSalt = String(options.hashSalt || "").trim();
    this.adminToken = String(options.adminToken || "").trim();
    this.ssl = Boolean(options.ssl);
    this.sslRejectUnauthorized = options.sslRejectUnauthorized !== false;
    this.poolFactory = options.poolFactory || ((poolOptions) => new Pool(poolOptions));
    this.pool = null;
    this.ready = false;
    this.lastError = null;
    this.initPromise = null;
    this.retryAfter = 0;
  }

  get enabled() {
    return Boolean(this.databaseUrl && this.hashSalt);
  }

  status() {
    return {
      enabled: this.enabled,
      ready: this.ready,
      adminConfigured: Boolean(this.adminToken),
      lastError: this.lastError ? "unavailable" : null,
    };
  }

  async start() {
    if (!this.enabled) return false;
    if (this.ready) return true;
    if (Date.now() < this.retryAfter) return false;
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.initialize().finally(() => { this.initPromise = null; });
    return this.initPromise;
  }

  async initialize() {
    try {
      this.pool = this.poolFactory({
        connectionString: this.databaseUrl,
        ssl: this.ssl ? { rejectUnauthorized: this.sslRejectUnauthorized } : undefined,
        max: 5,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 10_000,
      });
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS benz_analytics_events (
          id BIGSERIAL PRIMARY KEY,
          occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          channel TEXT NOT NULL CHECK (channel IN ('web', 'telegram')),
          event_type TEXT NOT NULL,
          visitor_hash CHAR(64) NOT NULL,
          is_bot BOOLEAN NOT NULL DEFAULT FALSE
        );
        CREATE INDEX IF NOT EXISTS benz_analytics_events_time_idx
          ON benz_analytics_events (occurred_at DESC);
        CREATE INDEX IF NOT EXISTS benz_analytics_events_rollup_idx
          ON benz_analytics_events (channel, event_type, occurred_at DESC);
      `);
      this.ready = true;
      this.retryAfter = 0;
      this.lastError = null;
      return true;
    } catch (error) {
      this.ready = false;
      this.retryAfter = Date.now() + 30_000;
      this.lastError = safeError(error);
      await this.pool?.end().catch(() => {});
      this.pool = null;
      return false;
    }
  }

  async record({ channel, eventType, visitorId, isBot = false }) {
    if (!this.enabled || !EVENT_TYPES.has(eventType) || !["web", "telegram"].includes(channel)) return false;
    const identity = String(visitorId || "").trim();
    if (!identity || identity.length > 256) return false;
    await this.start();
    if (!this.ready) return false;
    try {
      await this.pool.query(
        "INSERT INTO benz_analytics_events (channel, event_type, visitor_hash, is_bot) VALUES ($1, $2, $3, $4)",
        [channel, eventType, this.hash(identity), Boolean(isBot)],
      );
      this.lastError = null;
      return true;
    } catch (error) {
      this.lastError = safeError(error);
      return false;
    }
  }

  recordWeb(eventType, visitorId, userAgent = "") {
    return this.record({ channel: "web", eventType, visitorId, isBot: isBotUserAgent(userAgent) });
  }

  recordTelegram(message) {
    const text = String(message?.text || "").trim();
    const eventType = text.startsWith("/") ? "telegram_command" : "telegram_search";
    return this.record({ channel: "telegram", eventType, visitorId: message?.userId || message?.chatId });
  }

  isAdminToken(value) {
    if (!this.adminToken || !value) return false;
    const expected = Buffer.from(this.adminToken);
    const actual = Buffer.from(String(value));
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  async stats() {
    await this.start();
    if (!this.ready) throw new Error("Analytics database is unavailable");
    const [totals, daily, breakdown] = await Promise.all([
      this.pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE channel = 'web' AND event_type = 'page_view' AND NOT is_bot)::int AS web_views,
          COUNT(DISTINCT visitor_hash) FILTER (WHERE channel = 'web' AND event_type = 'page_view' AND NOT is_bot)::int AS web_visitors,
          COUNT(*) FILTER (WHERE channel = 'web' AND event_type = 'search' AND NOT is_bot)::int AS web_searches,
          COUNT(*) FILTER (WHERE channel = 'web' AND is_bot)::int AS web_bot_events,
          COUNT(*) FILTER (WHERE channel = 'telegram')::int AS telegram_messages,
          COUNT(DISTINCT visitor_hash) FILTER (WHERE channel = 'telegram')::int AS telegram_users
        FROM benz_analytics_events
        WHERE occurred_at >= NOW() - INTERVAL '30 days'
      `),
      this.pool.query(`
        SELECT
          TO_CHAR((occurred_at AT TIME ZONE 'Europe/Moscow')::date, 'YYYY-MM-DD') AS day,
          COUNT(*) FILTER (WHERE channel = 'web' AND event_type = 'page_view' AND NOT is_bot)::int AS web_views,
          COUNT(DISTINCT visitor_hash) FILTER (WHERE channel = 'web' AND event_type = 'page_view' AND NOT is_bot)::int AS web_visitors,
          COUNT(*) FILTER (WHERE channel = 'web' AND event_type = 'search' AND NOT is_bot)::int AS web_searches,
          COUNT(*) FILTER (WHERE channel = 'telegram')::int AS telegram_messages,
          COUNT(DISTINCT visitor_hash) FILTER (WHERE channel = 'telegram')::int AS telegram_users
        FROM benz_analytics_events
        WHERE occurred_at >= NOW() - INTERVAL '30 days'
        GROUP BY 1
        ORDER BY 1 DESC
      `),
      this.pool.query(`
        SELECT channel, event_type, is_bot, COUNT(*)::int AS events
        FROM benz_analytics_events
        WHERE occurred_at >= NOW() - INTERVAL '30 days'
        GROUP BY channel, event_type, is_bot
        ORDER BY channel, event_type, is_bot
      `),
    ]);
    return {
      periodDays: 30,
      generatedAt: new Date().toISOString(),
      totals: totals.rows[0],
      daily: daily.rows,
      breakdown: breakdown.rows,
    };
  }

  hash(value) {
    return createHmac("sha256", this.hashSalt).update(String(value)).digest("hex");
  }

  async close() {
    await this.initPromise?.catch(() => {});
    this.ready = false;
    await this.pool?.end().catch(() => {});
    this.pool = null;
  }
}

export function isBotUserAgent(value) {
  return BOT_USER_AGENT.test(String(value || ""));
}

function safeError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/postgres(?:ql)?:\/\/[^\s@]+@/gi, "postgresql://[redacted]@").slice(0, 300);
}
