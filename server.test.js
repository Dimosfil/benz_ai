import test from "node:test";
import assert from "node:assert/strict";
import { normalizeGdebenzStation } from "./providers/gdebenz.js";
import { normalizeMultigoStation } from "./providers/multigo.js";
import { chromeArguments } from "./providers/sber-browser.js";
import { isYandexVerificationCandidate, mergeStations, normalizeBenzupStation, normalizeFuelName, normalizeSberStation, parseYandexFuelPrices } from "./server.js";

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
  assert.equal(isYandexVerificationCandidate({ overallStatus: "maybe_available", yandexOrgId: "123" }), false);
  assert.equal(isYandexVerificationCandidate({ overallStatus: "available", yandexOrgId: null }), false);
});
