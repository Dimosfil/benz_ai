import test from "node:test";
import assert from "node:assert/strict";
import { AnalyticsService, isBotUserAgent } from "./services/analytics.js";

test("recognizes common robot user agents without classifying browsers as bots", () => {
  assert.equal(isBotUserAgent("Mozilla/5.0 Chrome/138 Safari/537.36"), false);
  assert.equal(isBotUserAgent("Googlebot/2.1"), true);
  assert.equal(isBotUserAgent("curl/8.0"), true);
});

test("initializes analytics and stores only a hashed visitor identity", async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [] };
    },
    async end() {},
  };
  const analytics = new AnalyticsService({
    databaseUrl: "postgresql://example.invalid/db",
    hashSalt: "test-salt",
    adminToken: "test-token",
    poolFactory: () => pool,
  });
  assert.equal(await analytics.recordWeb("page_view", "visitor-123", "Mozilla/5.0"), true);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].params[0], "web");
  assert.equal(calls[1].params[1], "page_view");
  assert.match(calls[1].params[2], /^[a-f0-9]{64}$/);
  assert.notEqual(calls[1].params[2], "visitor-123");
  assert.equal(calls[1].params[3], false);
  assert.equal(analytics.isAdminToken("test-token"), true);
  assert.equal(analytics.isAdminToken("wrong-token"), false);
});

test("analytics stays disabled when private configuration is incomplete", async () => {
  const analytics = new AnalyticsService({ databaseUrl: "postgresql://example.invalid/db" });
  assert.equal(analytics.enabled, false);
  assert.equal(await analytics.recordTelegram({ userId: "42", text: "Воронеж" }), false);
});
