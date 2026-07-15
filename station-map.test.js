import test from "node:test";
import assert from "node:assert/strict";
import { hasMapCoordinates, stationMapStatus, stationViewportUrl } from "./public/station-map.js";

test("map accepts valid station coordinates and rejects invalid values", () => {
  assert.equal(hasMapCoordinates({ lat: 51.67, lon: 39.21 }), true);
  assert.equal(hasMapCoordinates({ lat: "55.75", lon: "37.62" }), true);
  assert.equal(hasMapCoordinates({ lat: 100, lon: 37.62 }), false);
  assert.equal(hasMapCoordinates({ lat: null, lon: 37.62 }), false);
});

test("map marker status follows the selected fuel aggregation", () => {
  const station = { overallStatus: "available", fuelStatus: { 92: "not_available", 95: "available" } };
  assert.equal(stationMapStatus(station, []), "available");
  assert.equal(stationMapStatus(station, ["92"]), "not_available");
  assert.equal(stationMapStatus(station, ["92", "95"]), "maybe_available");
});

test("map viewport request uses the visible bounds", () => {
  const url = new URL(stationViewportUrl({ south: 51.5, north: 51.8, west: 39, east: 39.4 }), "http://localhost");
  assert.equal(url.pathname, "/api/stations");
  assert.equal(url.searchParams.get("minLat"), "51.500000");
  assert.equal(url.searchParams.get("maxLon"), "39.400000");
});
