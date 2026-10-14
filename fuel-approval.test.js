import test from "node:test";
import assert from "node:assert/strict";
import { mergeStations, summarizeStations } from "./domain/stations.js";
import { StationObservations } from "./domain/station-observations.js";
import { normalizeAlfaStation } from "./providers/alfa.js";
import { normalizeGdebenzStation } from "./providers/gdebenz.js";
import { minimumPrice, selectionStatus, stationConfidence, stationFuelEntries, stationLastPaymentAt, stationPriceText } from "./public/station-view.js";
import { mergeStationCache } from "./public/station-map.js";
import { normalizeSelectedFuels } from "./public/station-filter.js";
import { formatTelegramSummary } from "./services/telegram-bot.js";

const NOW = Date.parse("2026-10-14T12:39:00Z");
const at = (minutes) => new Date(NOW - minutes * 60_000).toISOString();
const bank = (minutes, fuelStatus = { 92: "available" }) => ({
  overallStatus: "available", fuelStatus, observedAt: at(minutes), paymentTimes: [at(minutes)],
});
const typedBank = (minutes, fuelStatus = { 92: "available" }) => ({ ...bank(minutes, fuelStatus),
  fuelObservedAt: Object.fromEntries(Object.keys(fuelStatus).map((fuel) => [fuel, at(minutes)])) });
function check(t, evidence, expected, selected = []) {
  const [station] = mergeStations([{ name: "АЗС", lat: 51.69258, lon: 39.377016,
    availabilityBySource: evidence, prices: { 92: { value: 65.25 } } }]);
  assert.equal(selected.length ? station.fuelStatus[selected[0]] : station.overallStatus, expected);
  assert.equal(selectionStatus(station, selected), expected);
  return station;
}
function freeze(t) { t.mock.timers.enable({ apis: ["Date"], now: NOW }); }

test("Babyakovo: an old diesel report cannot approve petrol or bypass the payment window", (t) => {
  freeze(t);
  const diesel = normalizeGdebenzStation({ osm_id: "1231385082", lat: 51.69258, lon: 39.377016,
    status: "yes", fuels_now: "ДТ", detail: "ДТ", last_at: at(195) });
  const evidence = { tbank: bank(33), alfa: bank(25), ...diesel.availabilityBySource };
  const station = check(t, evidence, "maybe_available");
  assert.equal(station.fuelStatus["92"], "maybe_available");
  assert.deepEqual(stationConfidence(station), { matching: 1, total: 1, percent: 100 });
  assert.equal(stationFuelEntries(station).find((entry) => entry.type === "92").status, "maybe_available");
});

test("matching bank and crowd statuses never replace two distinct recent operations", (t) => {
  freeze(t);
  for (const evidence of [
    { tbank: bank(5), alfa: bank(5) },
    { tbank: bank(5), gdebenz: bank(10) },
    { yandex: { ...bank(5), confirmations: 3 } },
    { tbank: bank(5), alfa: bank(31), gdebenz: bank(2) },
  ]) {
    check(t, evidence, "maybe_available");
    check(t, evidence, "maybe_available", ["92"]);
  }
});

test("two operations approve only fuel with current grade-specific evidence", (t) => {
  freeze(t);
  const dieselOnly = { tbank: bank(5, { DT: "available" }), alfa: bank(20, { DT: "available" }) };
  check(t, dieselOnly, "no_data");
  const diesel = check(t, dieselOnly, "no_data");
  assert.equal(diesel.fuelStatus.DT, undefined);
  assert.equal(selectionStatus(diesel, ["DT"]), "no_data");
  const petrol = { tbank: bank(5), alfa: typedBank(20) };
  check(t, petrol, "available");
  check(t, petrol, "available", ["92"]);
  t.mock.timers.tick(10 * 60_000 + 1);
  check(t, petrol, "maybe_available");
  check(t, petrol, "maybe_available", ["92"]);
});

test("fresh diesel payments never refresh Alfa's old petrol observation", (t) => {
  freeze(t);
  const alfa = normalizeAlfaStation({ station_id: "alfa", address: { location: { latitude: 51.69258, longitude: 39.377016 } },
    fuels: [{ category: "AI92", status: "available", last_transaction_at: at(90) },
      { category: "DT", status: "available", last_transaction_at: at(5) }] });
  const evidence = { tbank: bank(20), ...alfa.availabilityBySource };
  check(t, evidence, "maybe_available");
  check(t, evidence, "maybe_available", ["92"]);
});

test("Alfa accumulates same-grade payments without crediting diesel history to petrol", (t) => {
  freeze(t);
  const history = new StationObservations();
  const snapshot = (petrol, diesel) => normalizeAlfaStation({ station_id: "alfa", name: "АЗС",
    address: { location: { latitude: 51.69258, longitude: 39.377016 } }, fuels: [
      { category: "AI92", status: "available", last_transaction_at: at(petrol) },
      { category: "DT", status: "available", last_transaction_at: at(diesel) },
    ] });
  history.observe([snapshot(20, 10)]);
  const unchanged = history.observe([snapshot(20, 5)])[0];
  check(t, unchanged.availabilityBySource, "maybe_available", ["92"]);
  const next = history.observe([snapshot(5, 5)])[0];
  check(t, next.availabilityBySource, "available", ["92"]);
});

test("browser snapshots preserve Alfa grade history and expire the same approval as the server", (t) => {
  freeze(t);
  const snapshot = (petrol, diesel) => normalizeAlfaStation({ station_id: "browser-alfa",
    address: { location: { latitude: 51.69258, longitude: 39.377016 } }, fuels: [
      { category: "AI92", status: "available", last_transaction_at: at(petrol) },
      { category: "DT", status: "available", last_transaction_at: at(diesel) },
    ] });
  const cache = new Map();
  const identities = new Map(), keys = new WeakMap();
  mergeStationCache(cache, identities, keys, [snapshot(20, 10)]);
  mergeStationCache(cache, identities, keys, [snapshot(20, 5)]);
  assert.equal(selectionStatus([...cache.values()][0], ["92"]), "maybe_available");
  mergeStationCache(cache, identities, keys, [snapshot(5, 5)]);
  const station = [...cache.values()][0];
  assert.equal(selectionStatus(station, ["92"]), "available");
  assert.equal(mergeStations([station])[0].fuelStatus["92"], "available");
  t.mock.timers.tick(10 * 60_000 + 1);
  assert.equal(selectionStatus(station, ["92"]), "maybe_available");
  assert.equal(mergeStations([station])[0].fuelStatus["92"], "maybe_available");
});

test("an on-site petrol absence report stays red and diesel is excluded from the result", (t) => {
  freeze(t);
  const fuelStatus = { 92: "available", 95: "available", DT: "available" };
  const [station] = mergeStations([{ name: "АЗС", lat: 51.69258, lon: 39.377016,
    availabilityBySource: { tbank: bank(5, fuelStatus), alfa: typedBank(20, fuelStatus) },
    fuelReports: [{ fuels: ["92", "95"], status: "not_available", observedAt: at(1) }] }]);
  assert.equal(station.overallStatus, "not_available");
  assert.equal(selectionStatus(station), "not_available");
  assert.equal(selectionStatus(station, ["92"]), "not_available");
  assert.equal(selectionStatus(station, ["DT"]), "no_data");
  assert.equal(station.fuelStatus.DT, undefined);
});

test("a price and an untyped positive report never identify petrol", (t) => {
  freeze(t);
  const crowd = normalizeGdebenzStation({ osm_id: "one", status: "yes", fuels_now: "", detail: "ДТ", last_at: at(2) });
  assert.deepEqual(crowd.fuelStatus, { DT: "available" });
  check(t, { ...crowd.availabilityBySource, tbank: bank(5, {}), alfa: bank(20, {}) }, "no_data");
});

test("two untyped purchases and bank grade labels still require a dated petrol approval", (t) => {
  freeze(t);
  const evidence = { tbank: { ...bank(5), paymentTimes: [at(5), at(20)] } };
  check(t, evidence, "maybe_available");
  check(t, evidence, "maybe_available", ["92"]);
  evidence.gdebenz = { ...bank(2), fuelStatus: { DT: "available" } };
  check(t, evidence, "maybe_available");
  evidence.yandex = { ...bank(2), confirmations: 1 };
  check(t, evidence, "maybe_available");
  evidence.yandex.confirmations = 2;
  check(t, evidence, "available", ["92"]);
});

test("undated, future and old grade confirmations cannot approve current petrol", (t) => {
  freeze(t);
  for (const observedAt of [null, "invalid", at(-1), at(61)]) {
    const evidence = { tbank: { ...bank(5), paymentTimes: [at(5), at(20)] },
      gdebenz: { overallStatus: "available", fuelStatus: { 92: "available" }, observedAt } };
    const station = check(t, evidence, "maybe_available");
    assert.deepEqual(stationConfidence(station), { matching: 1, total: 1, percent: 100 });
  }
});

test("only petrol contributes to aggregate fuel rows, prices and price coverage", (t) => {
  freeze(t);
  const input = { name: "АЗС", lat: 51.69258, lon: 39.377016,
    fuelStatus: { 92: "available", DT: "available", CNG: "available", OTHER: "available" },
    prices: { 92: { value: 65.25 }, DT: { value: 30 }, CNG: { value: 10 } },
    availabilityBySource: { alfa: typedBank(5, { 92: "available", DT: "available" }) } };
  const [station] = mergeStations([input]);
  assert.deepEqual(Object.keys(station.fuelStatus), ["92"]);
  assert.deepEqual(Object.keys(station.prices), ["92"]);
  assert.deepEqual(Object.keys(summarizeStations([station]).fuels), ["92"]);
  assert.equal(minimumPrice(input), 65.25, "old server responses cannot rank diesel as cheap petrol");
  assert.deepEqual(stationFuelEntries(input).map((entry) => entry.type), ["92"]);
  assert.doesNotMatch(stationPriceText(input), /ДТ|Метан|30|10/);
  assert.equal(summarizeStations([{ ...input, prices: { DT: { value: 30 } } }]).withPrices, 0);
});

test("Alfa's latest diesel operation cannot refresh the displayed petrol date", (t) => {
  freeze(t);
  const alfa = normalizeAlfaStation({ station_id: "dates", address: { location: { latitude: 51.69258, longitude: 39.377016 } },
    fuels: [{ category: "AI92", status: "available", last_transaction_at: at(45) },
      { category: "DT", status: "available", last_transaction_at: at(2) }] });
  const [station] = mergeStations([alfa]);
  assert.equal(station.lastTransactionAt, at(45));
  assert.equal(stationLastPaymentAt(station), at(45));
  assert.equal(summarizeStations([station]).freshness.latestAt, at(45));
  const [diesel] = mergeStations([{ ...alfa, availabilityBySource: { alfa: typedBank(2, { DT: "available" }) } }]);
  assert.equal(diesel.lastTransactionAt, null);
  assert.equal(stationLastPaymentAt(diesel), null);
});

test("persisted diesel selections are discarded while petrol selection survives", () => {
  const oldOptions = ["92", "95", "DT", "LPG", "CNG"];
  assert.deepEqual(normalizeSelectedFuels(["DT"], oldOptions), []);
  assert.deepEqual(normalizeSelectedFuels(["92", "DT"], oldOptions), ["92"]);
  assert.deepEqual(normalizeSelectedFuels(oldOptions, oldOptions), []);
});

test("Telegram suppresses non-petrol fuel rows and prices from legacy responses", () => {
  const text = formatTelegramSummary({ location: { name: "Бабяково" },
    summary: { total: 1, fuels: { 92: { maybe_available: 1 }, DT: { available: 1 }, CNG: { available: 1 } },
      statuses: { maybe_available: 1 } }, stations: [{ name: "Газпром", overallStatus: "maybe_available",
      fuelStatus: { 92: "maybe_available", DT: "available", CNG: "available" },
      prices: { 92: { value: 65.25 }, DT: { value: 30 }, CNG: { value: 10 } } }] });
  assert.match(text, /По маркам бензина/);
  assert.match(text, /65,25/);
  assert.doesNotMatch(text, /DT:|CNG:|DT —|CNG —|30,00|10,00/);
});

test("an explicitly diesel-only negative report cannot veto petrol payments", (t) => {
  freeze(t);
  const diesel = normalizeGdebenzStation({ osm_id: "diesel", status: "no", fuels_now: "", detail: "ДТ", last_at: at(1) });
  assert.deepEqual(diesel.fuelStatus, { DT: "not_available" });
  check(t, { tbank: bank(5), alfa: typedBank(20), ...diesel.availabilityBySource }, "available");
  const queue = normalizeGdebenzStation({ osm_id: "queue", status: "yes", detail: "Очередь 92 машины", last_at: at(1) });
  assert.deepEqual(queue.fuelStatus, {}, "numbers in a narrative must not become petrol grades");
  const conflicted = normalizeGdebenzStation({ osm_id: "conflict", status: "yes", fuels_now: "92,95", detail: "ДТ", last_at: at(1) });
  assert.deepEqual(conflicted.fuelStatus, { 92: "no_data", 95: "no_data" });
  check(t, { tbank: { ...bank(5), paymentTimes: [at(5), at(20)] }, ...conflicted.availabilityBySource }, "maybe_available");
});
