import test from "node:test";
import assert from "node:assert/strict";
import { mergeStations } from "./domain/stations.js";
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
    station("multigo", "two", 51.60001, 39.20001, "АГНКС"),
  ]);
  assert.equal(result.length, 2);
});

test("still merges records for the same station from different providers", () => {
  const result = mergeStations([
    station("tbank", "one", 51.6, 39.2, "Лукойл"),
    station("multigo", "two", 51.60001, 39.20001, "Лукойл"),
  ]);
  assert.equal(result.length, 1);
  assert.equal(stationSources(result[0]), "T‑Bank Fuel + Multigo");
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

test("normalizes and moves persisted table columns", () => {
  assert.deepEqual(normalizeColumnOrder(["bad"]), ["name", "sources", "status", "fuel", "price", "fresh"]);
  assert.deepEqual(
    moveColumnOrder(["name", "sources", "status", "fuel", "price", "fresh"], "fresh", "name"),
    ["fresh", "name", "sources", "status", "fuel", "price"],
  );
});
