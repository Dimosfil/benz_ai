import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { normalizeGdebenzStation } from "./providers/gdebenz.js";
import { normalizeMultigoStation } from "./providers/multigo.js";
import { chromeArguments, SberBrowserWorker } from "./providers/sber-browser.js";
import { clearYandexCache, enrichYandexPrices } from "./providers/yandex.js";
import { alfaProviderCall, isYandexVerificationCandidate, mergeStations, normalizeBenzupStation, normalizeFuelName, normalizeSberStation, parseYandexFuelPrices, readBbox, startServer, withTimeout } from "./server.js";

test("does not call Alfa when the provider is disabled", async () => {
  let called = false;
  const result = await alfaProviderCall({}, async () => {
    called = true;
    return { stations: [] };
  }, false);

  assert.equal(called, false);
  assert.equal(result, null);
});

test("starts the Sber Chromium worker without a GUI", () => {
  const args = chromeArguments("C:\\Temp\\benz-ai-sber-test");
  assert.ok(args.includes("--headless"));
  assert.ok(args.includes("--no-startup-window"));
  assert.ok(args.includes("--noerrdialogs"));
  assert.ok(!args.includes("--headless=new"));
});

test("enables Chromium's container flag only through explicit configuration", () => {
  const previous = process.env.CHROME_NO_SANDBOX;
  process.env.CHROME_NO_SANDBOX = "1";
  try {
    assert.ok(chromeArguments("/tmp/benz-ai-sber-test").includes("--no-sandbox"));
  } finally {
    if (previous === undefined) delete process.env.CHROME_NO_SANDBOX;
    else process.env.CHROME_NO_SANDBOX = previous;
  }
});

test("reports a safe stopped Sber worker lifecycle", () => {
  const worker = new SberBrowserWorker({
    refreshMs: 12_000,
    activeAreaTtlMs: 34_000,
    maxActiveAreas: 2,
    browserIdleMs: 5_000,
    requestTimeoutMs: 12_000,
  });
  assert.deepEqual(worker.status(), {
    running: false,
    lifecycle: "stopped",
    activeAreas: 0,
    activeOperations: 0,
    refreshMs: 12_000,
    activeAreaTtlMs: 34_000,
    browserIdleMs: 5_000,
    requestTimeoutMs: 12_000,
    lastActivityAt: null,
    lastStartedAt: null,
    lastStoppedAt: null,
    lastStopReason: null,
    lastRefreshAt: null,
    lastError: null,
  });
});

test("bounds a slow viewport provider call", async () => {
  let aborted = false;
  await assert.rejects(
    withTimeout(new Promise(() => {}), 5, "ожидание данных", () => { aborted = true; }),
    /превышено время ожидания/,
  );
  assert.equal(aborted, true);
});

test("requires a complete bbox inside geographic ranges", () => {
  assert.throws(() => readBbox(new URLSearchParams("minLat=1&maxLat=2&minLon=3")), /maxLon обязателен/);
  assert.throws(() => readBbox(new URLSearchParams("minLat=-91&maxLat=2&minLon=3&maxLon=4")), /допустимый диапазон/);
  assert.deepEqual(readBbox(new URLSearchParams("minLat=1&maxLat=2&minLon=3&maxLon=4")), {
    minLat: 1, maxLat: 2, minLon: 3, maxLon: 4,
  });
});

test("serves hardened HTTP headers and rejects writes to static files", async () => {
  const server = startServer(0, "127.0.0.1");
  try {
    await once(server, "listening");
    const base = `http://127.0.0.1:${server.address().port}`;
    const health = await fetch(`${base}/api/health`);
    assert.equal(health.status, 200);
    assert.match(health.headers.get("content-security-policy"), /frame-ancestors 'none'/);
    assert.equal(health.headers.get("x-content-type-options"), "nosniff");
    const write = await fetch(`${base}/index.html`, { method: "POST" });
    assert.equal(write.status, 405);
    const head = await fetch(`${base}/index.html`, { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.ok(Number(head.headers.get("content-length")) > 0);
    assert.equal(await head.text(), "");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await server.waitForCleanup();
  }
});

test("removes stale Sber areas before scheduling an idle browser close", async () => {
  const worker = new SberBrowserWorker({ activeAreaTtlMs: 1, browserIdleMs: 1 });
  worker.areas.set("stale", { accessedAt: Date.now() - 10, fetchedAt: 0, data: null, error: null });
  await worker.refreshActiveAreas();
  assert.equal(worker.areas.size, 0);
  assert.equal(worker.activeOperations, 0);
});

test("stops an idle Sber browser after the configured grace period", async () => {
  const worker = new SberBrowserWorker({ browserIdleMs: 1 });
  worker.cdp = { close() {} };
  worker.scheduleIdleClose();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(worker.status().lifecycle, "stopped");
  assert.equal(worker.status().lastStopReason, "idle_timeout");
  assert.ok(worker.status().lastStoppedAt);
});

test("does not reset the Sber idle close timer when there are no active areas", async () => {
  const worker = new SberBrowserWorker({ browserIdleMs: 1 });
  worker.cdp = { close() {} };
  await worker.refreshActiveAreas();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(worker.status().lastStopReason, "idle_timeout");
});

test("defers a new Sber browser start until an in-progress stop completes", async () => {
  const worker = new SberBrowserWorker();
  let releaseStop;
  worker.closePromise = new Promise((resolve) => { releaseStop = resolve; });
  let started = false;
  worker.start = async () => {
    started = true;
    worker.cdp = {};
  };

  const starting = worker.ensureStarted();
  assert.equal(started, false);
  releaseStop();
  await starting;
  assert.equal(started, true);
  assert.equal(worker.cdp !== null, true);
});

test("normalizes common fuel names", () => {
  assert.equal(normalizeFuelName("АИ-95"), "95");
  assert.equal(normalizeFuelName("Дизель"), "DT");
  assert.equal(normalizeFuelName("Пропан"), "LPG");
});

test("extracts Yandex prices and ignores a dash", () => {
  const html = String.raw`search-fuel-info-view__name\"\u003eАИ-92\u003c/div\u003e\u003cdiv class=\"search-fuel-info-view__value\"\u003e64,15\u003c/div\u003esearch-fuel-info-view__name\"\u003eАИ-98\u003c/div\u003e\u003cdiv class=\"search-fuel-info-view__value\"\u003e–\u003c/div\u003eОбновлено 10 июля 2026 по данным`;
  const result = parseYandexFuelPrices(html);
  assert.equal(result.prices["92"].value, 64.15);
  assert.equal(result.prices["98"], undefined);
  assert.equal(result.updatedAt, "10 июля 2026");
});

test("normalizes a BenzUp-compatible station payload", () => {
  const station = normalizeBenzupStation({
    id: 7,
    name: "Тестовая АЗС",
    latitude: 51.69,
    longitude: 39.38,
    products: [{ fuelName: "АИ-92", price: 64.5 }],
  });
  assert.equal(station.externalId, "7");
  assert.equal(station.prices["92"].value, 64.5);
});

test("merges provider records for the same nearby station", () => {
  const merged = mergeStations([
    { name: "Газпром", lat: 51.69, lon: 39.38, sourceRefs: [{ source: "tbank", externalId: "a" }], prices: {}, links: {}, availabilityBySource: { tbank: {} } },
    { name: "Газпром", lat: 51.6901, lon: 39.3801, sourceRefs: [{ source: "benzup", externalId: "b" }], prices: { 92: { value: 64, source: "benzup" } }, links: {}, availabilityBySource: {} },
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].sourceRefs.length, 2);
  assert.equal(merged[0].prices["92"].value, 64);
});

test("normalizes Sber station availability", () => {
  const station = normalizeSberStation({
    id: "s1",
    name: "АЗС",
    location: { lat: 51.6, lon: 39.2 },
    availabilityStatus: "available",
    lastPaymentAt: "2026-07-10T17:12:00+03:00",
    fuels: [{ type: "ai92", availabilityStatus: "available" }, { type: "diesel", availabilityStatus: "stale" }],
  });
  assert.equal(station.overallStatus, "available");
  assert.equal(station.fuelStatus["92"], "available");
  assert.equal(station.fuelStatus.DT, "maybe_available");
  assert.equal(station.availabilityBySource.sber.operationsCount, null);
});

test("preserves an explicit zero Sber operation count", () => {
  const station = normalizeSberStation({
    id: "s2",
    location: { lat: 51.6, lon: 39.2 },
    availabilityStatus: "unknown",
    operationsCount: 0,
    fuels: [],
  });
  assert.equal(station.availabilityBySource.sber.operationsCount, 0);
});

test("normalizes ГдеБЕНЗ status details", () => {
  const station = normalizeGdebenzStation({
    osm_id: "g1",
    name: "АЗС",
    lat: 51.6,
    lon: 39.2,
    status: "queue",
    fuels_now: "92,95,ДТ",
    confirmations: 4,
    confidence_base: 0.7,
    last_at: "2026-07-10 14:00:00",
  });
  assert.equal(station.overallStatus, "available");
  assert.equal(station.fuelStatus.DT, "available");
  assert.equal(station.confirmations, 4);
});

test("normalizes a Multigo place without claiming fuel availability", () => {
  const station = normalizeMultigoStation({
    id: "m1",
    name: "ЭлЗС",
    loc: [55.75, 37.61],
    address: "Москва",
    status: "Нормальное",
    subCategory: { name: "ЭлЗС" },
    fuels: [],
    __dist: 620,
  });
  assert.equal(station.externalId, "m1");
  assert.equal(station.lat, 55.75);
  assert.equal(station.overallStatus, "no_data");
  assert.deepEqual(station.availabilityBySource, {});
  assert.equal(station.multigo.distanceMeters, 620);
});

test("checks only probable-availability stations with a Yandex card", () => {
  assert.equal(isYandexVerificationCandidate({ overallStatus: "available", yandexOrgId: "123" }), true);
  assert.equal(isYandexVerificationCandidate({
    overallStatus: "maybe_available",
    yandexOrgId: "123",
    availabilityBySource: { tbank: { overallStatus: "available", fuelStatus: {} } },
  }), true);
  assert.equal(isYandexVerificationCandidate({ overallStatus: "maybe_available", yandexOrgId: "123" }), false);
  assert.equal(isYandexVerificationCandidate({ overallStatus: "available", yandexOrgId: null }), false);
});

test("Yandex cache stores only Yandex enrichment, not an old station snapshot", async () => {
  const previousFetch = globalThis.fetch;
  let requests = 0;
  clearYandexCache();
  globalThis.fetch = async () => {
    requests += 1;
    return new Response('<div class="search-fuel-info-view__name">АИ-95</div><div class="search-fuel-info-view__value">70,50 ₽</div>');
  };
  const base = {
    name: "АЗС",
    overallStatus: "available",
    yandexOrgId: "123",
    availabilityBySource: { tbank: { overallStatus: "available" } },
    sourceRefs: [{ source: "tbank", externalId: "one" }],
  };
  try {
    await enrichYandexPrices([{ ...base, prices: { 92: { value: 60 } } }]);
    const second = await enrichYandexPrices([{ ...base, prices: { DT: { value: 75 } } }]);
    assert.equal(requests, 1);
    assert.equal(second.stations[0].prices.DT.value, 75);
    assert.equal(second.stations[0].prices["95"].value, 70.5);
    assert.equal(second.stations[0].prices["92"], undefined);
  } finally {
    globalThis.fetch = previousFetch;
    clearYandexCache();
  }
});
