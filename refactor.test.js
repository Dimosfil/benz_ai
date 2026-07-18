import test from "node:test";
import assert from "node:assert/strict";
import { mergeStations, summarizeStations } from "./domain/stations.js";
import { selectMultigoStations } from "./providers/multigo.js";
import { filterStations, normalizeSelectedFuels } from "./public/station-filter.js";
import { moveColumnOrder, normalizeColumnOrder } from "./public/table-order.js";
import { stationSources } from "./public/station-view.js";

function station(source, externalId, lat, lon, name = "АЗС") {
  return {
    source,
    sourceRefs: [{ source, externalId }],
    externalId,
    name,
    address: "Адрес",
    lat,
    lon,
    overallStatus: "no_data",
    fuelStatus: {},
    availabilityBySource: {},
    prices: {},
    links: {},
    yandexOrgId: null,
    lastTransactionAt: null,
  };
}

test("does not merge nearby records with different IDs from the same provider", () => {
  const result = mergeStations([
    station("multigo", "one", 51.6, 39.2, "АГНКС"),
    station("multigo", "two", 51.6001, 39.2001, "АГНКС"),
  ]);
  assert.equal(result.length, 2);
});

test("merges an orphan provider duplicate after another source confirms the station", () => {
  const primary = station("tbank", "primary", 51.684624, 39.48504, "Интрансгаз");
  const orphan = station("tbank", "orphan", 51.684589, 39.484893, "Интрансгаз");
  const confirmation = station("multigo", "confirmed", 51.68462, 39.48502, "Интрансгаз");

  const result = mergeStations([primary, orphan, confirmation]);

  assert.equal(result.length, 1);
  assert.deepEqual(result[0].sourceRefs.map((ref) => `${ref.source}:${ref.externalId}`), [
    "tbank:primary",
    "multigo:confirmed",
    "tbank:orphan",
  ]);
});

test("merges exact co-located catalog duplicates and keeps fresh evidence", () => {
  const bank = station("tbank", "bank", 51.69258, 39.377016, "Газпром");
  bank.address = "Бабяково, Транспортная улица";
  bank.availabilityBySource = { tbank: { overallStatus: "no_data", fuelStatus: { 92: "no_data" }, observedAt: null } };
  const agnks = station("sber", "gas", 51.692568, 39.377002, "Газпром АГНКС");
  agnks.address = "Воронежская область, Бабяково, 16 километр, 1";
  agnks.availabilityBySource = { sber: { overallStatus: "no_data", fuelStatus: { CNG: "no_data" }, observedAt: null } };
  const petrol = station("sber", "petrol", 51.692568, 39.377002, "Газпромнефть");
  petrol.address = agnks.address;
  petrol.availabilityBySource = { sber: { overallStatus: "no_data", fuelStatus: { 92: "no_data", 95: "no_data" }, observedAt: null } };
  const report = station("gdebenz", "report", 51.6927, 39.3769, "Газпром");
  report.address = "Совхозная улица, 9А";
  report.availabilityBySource = {
    gdebenz: {
      overallStatus: "available",
      fuelStatus: { 92: "available", 95: "available", DT: "available" },
      observedAt: "2026-07-11T07:25:30+03:00",
      confirmations: 3,
      confidence: 0.55,
    },
  };

  const result = mergeStations([bank, agnks, petrol, report]);

  assert.equal(result.length, 1);
  assert.deepEqual(result[0].sourceRefs.map((ref) => `${ref.source}:${ref.externalId}`), [
    "tbank:bank",
    "sber:gas",
    "sber:petrol",
    "gdebenz:report",
  ]);
  assert.equal(result[0].overallStatus, "maybe_available");
  assert.equal(result[0].name, "Газпромнефть");
  assert.equal(result[0].fuelStatus["92"], "maybe_available");
  assert.equal(result[0].fuelStatus.CNG, "no_data");
  assert.equal(result[0].availabilityBySource.gdebenz.confirmations, 3);
});

test("finds a merged station by any catalog name or address", () => {
  const stations = [{
    name: "Газпромнефть",
    address: "Воронеж-Тамбов, 16 километр",
    nameAliases: ["Газпром", "Газпром АГНКС"],
    addressAliases: ["Транспортная улица"],
    overallStatus: "available",
    fuelStatus: {},
  }];
  assert.equal(filterStations(stations, { text: "Газпром АГНКС" }).length, 1);
  assert.equal(filterStations(stations, { text: "Транспортная" }).length, 1);
});

test("still merges records for the same station from different providers", () => {
  const result = mergeStations([
    station("tbank", "one", 51.6, 39.2, "Лукойл"),
    station("multigo", "two", 51.60001, 39.20001, "Лукойл"),
  ]);
  assert.equal(result.length, 1);
  assert.equal(stationSources(result[0]), "T‑Bank Fuel + Multigo");
});

test("does not merge different neighbouring stations from separate providers", () => {
  const first = station("tbank", "one", 55, 37, "АЗС А");
  first.address = "Северная сторона трассы";
  const second = station("alfa", "two", 55.00025, 37, "АЗС Б");
  second.address = "Южная сторона трассы";
  const result = mergeStations([first, second]);
  assert.equal(result.length, 2);
});

test("downgrades a lone positive source before building the summary", () => {
  const only = station("tbank", "one", 55, 37, "АЗС");
  only.availabilityBySource = { tbank: { overallStatus: "available", fuelStatus: { 92: "available" } } };
  const [merged] = mergeStations([only]);
  assert.equal(merged.overallStatus, "maybe_available");
  assert.equal(summarizeStations([merged]).statuses.maybe_available, 1);
});

test("keeps a price paired with the newest publication time", () => {
  const old = station("benzup", "old", 55, 37, "АЗС");
  old.prices = { 92: { value: 50, currency: "RUB", source: "benzup" } };
  old.priceUpdatedAt = "2026-07-01T10:00:00Z";
  const fresh = station("alfa", "fresh", 55, 37, "АЗС");
  fresh.prices = { 92: { value: 60, currency: "RUB", source: "alfa" } };
  fresh.priceUpdatedAt = "2026-07-02T10:00:00Z";
  const [merged] = mergeStations([old, fresh]);
  assert.equal(merged.prices["92"].value, 60);
  assert.equal(merged.priceUpdatedAt, fresh.priceUpdatedAt);
});

test("summary ignores impossible future freshness and nonpositive prices", () => {
  const item = station("tbank", "future", 55, 37, "АЗС");
  item.lastTransactionAt = "2999-01-01T00:00:00Z";
  item.prices = { 92: { value: 0 } };
  const summary = summarizeStations([item]);
  assert.equal(summary.freshness.withTimestamp, 0);
  assert.equal(summary.freshness.latestAt, null);
  assert.equal(summary.withPrices, 0);
});

test("keeps only Multigo fuel places inside the requested territory", () => {
  const bbox = { minLat: 51.5, maxLat: 51.7, minLon: 39.1, maxLon: 39.3 };
  const result = selectMultigoStations([
    { id: "inside", name: "АЗС", loc: [51.6, 39.2], fuels: [], subCategory: { name: "АЗС" } },
    { id: "outside", name: "АЗС", loc: [52, 40], fuels: [], subCategory: { name: "АЗС" } },
    { id: "electric", name: "ЭлЗС", loc: [51.61, 39.21], fuels: [], subCategory: { name: "ЭлЗС" } },
  ], bbox);
  assert.deepEqual(result.stations.map((item) => item.externalId), ["inside"]);
  assert.equal(result.droppedOutside, 1);
  assert.equal(result.droppedElectric, 1);
});

test("treats selecting every fuel as an unrestricted filter", () => {
  const available = ["92", "95", "DT"];
  assert.deepEqual(normalizeSelectedFuels(available, available), []);
  assert.deepEqual(normalizeSelectedFuels(["92"], available), ["92"]);
  const stations = [
    { name: "Без данных", address: "А", overallStatus: "no_data", fuelStatus: {} },
    { name: "С бензином", address: "Б", overallStatus: "available", fuelStatus: { 92: "available" } },
  ];
  assert.equal(filterStations(stations, { fuels: [] }).length, 2);
  assert.equal(filterStations(stations, { fuels: ["92"] }).length, 1);
});

test("fuel filter includes a station that has only a published price", () => {
  const priceOnly = station("benzup", "price", 55, 37, "АЗС");
  priceOnly.prices = { 95: { value: 70, currency: "RUB", source: "benzup" } };
  assert.equal(filterStations([priceOnly], { fuels: ["95"] }).length, 1);
});

test("normalizes and moves persisted table columns", () => {
  assert.deepEqual(normalizeColumnOrder(["bad"]), ["name", "sources", "status", "fuel", "price", "fresh"]);
  assert.deepEqual(
    moveColumnOrder(["name", "sources", "status", "fuel", "price", "fresh"], "fresh", "name"),
    ["fresh", "name", "sources", "status", "fuel", "price"],
  );
});
