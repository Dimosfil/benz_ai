import test from "node:test";
import assert from "node:assert/strict";
import { parseYandexPriceDocument } from "./providers/yandex-price-document.js";
import { clearYandexCache, enrichYandexPrices, fetchYandexStationPrices } from "./providers/yandex.js";

function statePage(items) {
  return `<script type="application/json" class="state-view">${JSON.stringify({ stack: [{ results: { items } }] })}</script>`;
}

const station = { id: "123", status: "permanent-closed", fuelInfo: {
  timestamp: 1789419600,
  items: [{ name: "АИ 92", price: { value: 64.95, currency: "RUB" } }, { name: "ДТ", price: { value: 77.1, currency: "RUB" } }],
} };

test("reads station-scoped structured prices without any rendered price HTML", () => {
  const result = parseYandexPriceDocument(statePage([
    { ...station, id: "other", fuelInfo: { items: [{ name: "АИ 92", price: { value: 1 } }] } }, station,
  ]), "123");
  assert.equal(result.status, "available");
  assert.equal(result.prices["92"].value, 64.95);
  assert.equal(result.prices.DT.value, 77.1);
  assert.equal(result.closed, true);
  assert.equal(result.updatedAt, new Date(1789419600 * 1000).toISOString());
  assert.equal(parseYandexPriceDocument(statePage([station]), "456").status, "unverified");
});

test("distinguishes an empty price list from absent or invalid upstream data", () => {
  assert.equal(parseYandexPriceDocument(statePage([{ id: "123" }]), "123").status, "unverified");
  assert.equal(parseYandexPriceDocument('<html>Please enable JavaScript</html>', "123").status, "unverified");
  assert.equal(parseYandexPriceDocument('<script class="state-view">invalid</script>', "123").status, "unverified");
  assert.equal(parseYandexPriceDocument(statePage([{ id: "123", fuelInfo: { items: [] } }]), "123").status, "not_published");
});

test("accepts whitespace, extra classes and nested text without converting a range to a price", () => {
  const html = (value) => `<div class="search-fuel-info-view__name extra"><span>АИ-95</span></div>\n<div data-x="1" class="search-fuel-info-view__value extra"><span>${value}</span></div>`;
  assert.equal(parseYandexPriceDocument(html("72,89 ₽")).prices["95"].value, 72.89);
  assert.equal(parseYandexPriceDocument(html("70–80 ₽")).status, "unverified");
  assert.equal(parseYandexPriceDocument(html("—")).status, "not_published");
});

test("does not cache an unrecognized document or missing prices and recovers on next request", async () => {
  const original = globalThis.fetch;
  clearYandexCache();
  let calls = 0;
  const pages = ['<html>JavaScript required</html>', statePage([{ id: "123", fuelInfo: { items: [] } }]), statePage([station])];
  globalThis.fetch = async () => new Response(pages[calls++]);
  try {
    await assert.rejects(fetchYandexStationPrices("123"), (error) => {
      assert.equal(error.code, "YANDEX_PRICES_UNVERIFIED");
      assert.equal(error.diagnostics.stateFound, false);
      assert.equal(error.diagnostics.upstreamStatus, 200);
      return true;
    });
    assert.equal((await fetchYandexStationPrices("123")).priceStatus, "not_published");
    const result = await fetchYandexStationPrices("123");
    assert.equal(result.prices["92"].value, 64.95);
    assert.equal(result.stationClosed, true);
    assert.equal(result.priceStatus, "available");
    await fetchYandexStationPrices("123");
    assert.equal(calls, 3);
  } finally { globalThis.fetch = original; clearYandexCache(); }
});

test("keeps valid availability for the summary when prices cannot be verified", async () => {
  const original = globalThis.fetch;
  clearYandexCache();
  globalThis.fetch = async () => new Response('<div class="gas-station-fuel-card-view__title">Топливо в наличии</div>');
  try {
    const result = await enrichYandexPrices([{ yandexOrgId: "123" }]);
    assert.equal(result.stations[0].availabilityBySource.yandex.overallStatus, "available");
    await assert.rejects(fetchYandexStationPrices("123"), { code: "YANDEX_PRICES_UNVERIFIED" });
  } finally { globalThis.fetch = original; clearYandexCache(); }
});
