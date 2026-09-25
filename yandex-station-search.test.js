import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { startServer } from "./server.js";
import { clearYandexCache } from "./providers/yandex.js";
import { clearSelectedStationPriceCache, fetchSelectedStationPrices, matchYandexStation } from "./providers/yandex-station-search.js";

const selected = { lat: 51.6927308, lon: 39.3768949, name: "Газпром" };
const item = { id: "38745431337", title: "Газпром", coordinates: [39.377016, 51.69258],
  fuelInfo: { timestamp: 1790197200, items: [{ name: "АИ 92", price: { value: 65.25, currency: "RUB" } }] } };
const page = (items) => `<script class="state-view">${JSON.stringify({ stack: [{ results: { items } }] })}</script>`;
const reset = () => { clearSelectedStationPriceCache(); clearYandexCache(); };

test("matches only a unique nearby station and never substitutes a neighbouring brand", () => {
  const neighbour = { ...item, id: "2", title: "Другая сеть" };
  assert.equal(matchYandexStation([neighbour, item], selected).id, item.id);
  assert.equal(matchYandexStation([neighbour], selected), null);
  assert.equal(matchYandexStation([{ ...item, title: "Газпром другая" }], { ...selected, name: "Газпром нефть" }), null);
  assert.equal(matchYandexStation([{ ...item, coordinates: [39.38, 51.7] }], selected), null);
  assert.equal(matchYandexStation([item, { ...item, id: "3" }], selected), null);
  assert.equal(matchYandexStation([item, neighbour], { ...selected, name: "АЗС №298" }), null);
  assert.equal(matchYandexStation([item], { ...selected, name: "АЗС №298" }).id, item.id);
  assert.equal(matchYandexStation([item, neighbour], { ...selected, yandexOrgId: "2" }).id, "2");
});

test("discovers prices without a T-Bank ID, shares requests and caches only the selected result", async () => {
  const original = globalThis.fetch;
  reset();
  let calls = 0;
  globalThis.fetch = async (url) => {
    calls++;
    assert.equal(url.origin, "https://yandex.ru");
    assert.equal(url.searchParams.get("ll"), "39.3768949,51.6927308");
    return new Response("<div>Обновлено 1 января по данным</div>" + page([{ ...item, id: "2", title: "Другая сеть", fuelInfo: { items: [{ name: "АИ 92", price: { value: 1 } }] } }, item]));
  };
  try {
    const [first, second] = await Promise.all([fetchSelectedStationPrices(selected), fetchSelectedStationPrices(selected)]);
    assert.deepEqual(first, second);
    assert.equal(first.yandexOrgId, item.id);
    assert.equal(first.prices["92"].value, 65.25);
    assert.equal(first.priceUpdatedAt, "2026-09-23T21:00:00.000Z");
    await fetchSelectedStationPrices(selected);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = original; reset(); }
});

test("uses search prices when the hosting organization page omits fuelInfo", async () => {
  const original = globalThis.fetch;
  reset();
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    return new Response(String(url).includes("/maps/org/") ? page([{ id: item.id }]) : page([item]));
  };
  try {
    const result = await fetchSelectedStationPrices({ ...selected, yandexOrgId: item.id });
    assert.equal(result.prices["92"].value, 65.25);
    assert.equal(urls.length, 2);
    assert.ok(urls[1].includes("ll="));
  } finally { globalThis.fetch = original; reset(); }
});

test("does not cache failed discovery and respects an access challenge", async () => {
  const original = globalThis.fetch;
  reset();
  let calls = 0;
  globalThis.fetch = async () => new Response(++calls === 1 ? "SmartCaptcha" : page([item]));
  try {
    await assert.rejects(fetchSelectedStationPrices(selected), { code: "YANDEX_ACCESS_CHECK" });
    assert.equal(calls, 1);
    assert.equal((await fetchSelectedStationPrices(selected)).yandexOrgId, item.id);
    assert.equal(calls, 2);
  } finally { globalThis.fetch = original; reset(); }
});

test("does not repeat a failed organization lookup after search also has no prices", async () => {
  const original = globalThis.fetch;
  reset();
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response(page([{ ...item, fuelInfo: undefined }]));
  };
  try {
    await assert.rejects(fetchSelectedStationPrices({ ...selected, yandexOrgId: item.id }), { code: "YANDEX_PRICES_UNVERIFIED" });
    assert.equal(calls, 2);
  } finally { globalThis.fetch = original; reset(); }
});

test("selected-station API accepts validated coordinates and keeps serving after an unexpected request error", async () => {
  const original = globalThis.fetch;
  const originalError = console.error;
  reset();
  globalThis.fetch = async (url, options) => String(url).startsWith("https://yandex.ru/maps/")
    ? new Response(page([item])) : original(url, options);
  console.error = () => {};
  const server = startServer(0, "127.0.0.1");
  try {
    await once(server, "listening");
    const base = `http://127.0.0.1:${server.address().port}`;
    const query = new URLSearchParams(selected);
    const response = await original(`${base}/api/station-prices?${query}`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).prices["92"].value, 65.25);
    for (const invalid of ["", "lat=91&lon=39&name=x", "lat=&lon=39&name=x", "lat=51&lon=39", "yandexOrgId=https://evil.example"]) {
      assert.equal((await original(`${base}/api/station-prices?${invalid}`)).status, 400);
    }
    assert.equal((await original(`${base}//[`)).status, 500);
    assert.equal((await original(`${base}/api/health`)).status, 200);
  } finally {
    globalThis.fetch = original;
    console.error = originalError;
    reset();
    await new Promise((resolve) => server.close(resolve));
    await server.waitForCleanup();
  }
});
