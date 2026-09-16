import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { startServer } from "./server.js";
import { clearYandexCache, fetchYandexStationPrices } from "./providers/yandex.js";

const fuelHtml = '<div class="search-fuel-info-view__name">АИ-92</div><div class="search-fuel-info-view__value">64,95 ₽</div>Обновлено 15 сентября 2026 по данным';

test("selected-station prices are fetched, cached and returned independently of viewport aggregation", async () => {
  const nativeFetch = globalThis.fetch;
  let calls = 0;
  clearYandexCache();
  globalThis.fetch = async (url, options) => {
    if (String(url).startsWith("https://yandex.ru/maps/org/")) {
      calls++;
      assert.equal(String(url), "https://yandex.ru/maps/org/38745431337/");
      return new Response(fuelHtml);
    }
    return nativeFetch(url, options);
  };
  const server = startServer(0, "127.0.0.1");
  try {
    await once(server, "listening");
    const base = `http://127.0.0.1:${server.address().port}/api/station-prices`;
    const response = await nativeFetch(`${base}?yandexOrgId=38745431337`);
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.prices["92"].value, 64.95);
    assert.equal(data.priceUpdatedAt, "15 сентября 2026");
    assert.equal(data.yandexOrgId, "38745431337");
    assert.ok(data.yandexCheckedAt);
    assert.equal(data.availability, undefined);
    await nativeFetch(`${base}?yandexOrgId=38745431337`);
    assert.equal(calls, 1);
    assert.equal((await nativeFetch(`${base}?yandexOrgId=https://evil.example`)).status, 400);
    assert.equal((await nativeFetch(`${base}?yandexOrgId=38745431337`, { method: "POST" })).status, 405);
    assert.equal(calls, 1);
    clearYandexCache();
    globalThis.fetch = async (url, options) => String(url).startsWith("https://yandex.ru/")
      ? new Response("SmartCaptcha") : nativeFetch(url, options);
    assert.equal((await nativeFetch(`${base}?yandexOrgId=38745431337`)).status, 503);
  } finally {
    globalThis.fetch = nativeFetch;
    clearYandexCache();
    await new Promise((resolve) => server.close(resolve));
    await server.waitForCleanup();
  }
});

test("concurrent opens share one upstream request and failed checks can retry", async () => {
  const nativeFetch = globalThis.fetch;
  let release;
  let calls = 0;
  clearYandexCache();
  globalThis.fetch = async () => {
    calls++;
    await new Promise((resolve) => { release = resolve; });
    return new Response("SmartCaptcha");
  };
  try {
    const first = fetchYandexStationPrices("123");
    const second = fetchYandexStationPrices("123");
    release();
    const results = await Promise.allSettled([first, second]);
    assert.equal(calls, 1);
    assert.ok(results.every((result) => result.status === "rejected"));
    globalThis.fetch = async () => new Response(fuelHtml);
    assert.equal((await fetchYandexStationPrices("123")).prices["92"].value, 64.95);
  } finally {
    globalThis.fetch = nativeFetch;
    clearYandexCache();
  }
});
