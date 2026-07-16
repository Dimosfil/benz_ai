import test from "node:test";
import assert from "node:assert/strict";
import {
  clusterStatusChart,
  hasMapCoordinates,
  padViewportBounds,
  stationMapStatus,
  stationViewportUrl,
  stationWithinBounds,
  uncoveredViewportBounds,
} from "./public/station-map.js";

test("map cluster chart reflects the child station status distribution", () => {
  assert.equal(clusterStatusChart(["not_available", "not_available"]), "#ef4444");
  assert.equal(
    clusterStatusChart(["available", "not_available"]),
    "conic-gradient(#12b76a 0% 50%, #ef4444 50% 100%)",
  );
  assert.equal(
    clusterStatusChart(["available", "maybe_available", "not_available", "no_data"]),
    "conic-gradient(#12b76a 0% 25%, #f59e0b 25% 50%, #ef4444 50% 75%, #64748b 75% 100%)",
  );
  assert.equal(clusterStatusChart([]), "#64748b");
  assert.equal(clusterStatusChart(["unexpected"]), "#64748b");
});

test("map accepts valid station coordinates and rejects invalid values", () => {
  assert.equal(hasMapCoordinates({ lat: 51.67, lon: 39.21 }), true);
  assert.equal(hasMapCoordinates({ lat: "55.75", lon: "37.62" }), true);
  assert.equal(hasMapCoordinates({ lat: 100, lon: 37.62 }), false);
  assert.equal(hasMapCoordinates({ lat: null, lon: 37.62 }), false);
});

test("map marker status follows the selected fuel aggregation", () => {
  const station = {
    overallStatus: "available",
    fuelStatus: { 92: "not_available", 95: "available" },
    availabilityBySource: {
      alfa: { overallStatus: "available", fuelStatus: { 92: "not_available", 95: "available" } },
      sber: { overallStatus: "available", fuelStatus: { 92: "not_available", 95: "available" } },
    },
  };
  assert.equal(stationMapStatus(station, []), "available");
  assert.equal(stationMapStatus(station, ["92"]), "not_available");
  assert.equal(stationMapStatus(station, ["92", "95"]), "maybe_available");
});

test("map viewport request uses the visible bounds", () => {
  const url = new URL(stationViewportUrl({ south: 51.5, north: 51.8, west: 39, east: 39.4 }), "http://localhost");
  assert.equal(url.pathname, "/api/stations");
  assert.equal(url.searchParams.get("mode"), "viewport");
  assert.equal(url.searchParams.get("minLat"), "51.500000");
  assert.equal(url.searchParams.get("maxLon"), "39.400000");
});

test("map pads the viewport for prefetch and retains stations inside the outer frame", () => {
  const visible = { south: 50, north: 52, west: 38, east: 42 };
  assert.deepEqual(padViewportBounds(visible, 0.5), { south: 49, north: 53, west: 36, east: 44 });
  assert.equal(stationWithinBounds({ lat: 52.8, lon: 43.5 }, padViewportBounds(visible, 0.5)), true);
  assert.equal(stationWithinBounds({ lat: 53.2, lon: 43.5 }, padViewportBounds(visible, 0.5)), false);
});

test("small map shifts inside the prefetched frame need no new request", () => {
  const loaded = { south: 49, north: 53, west: 36, east: 44 };
  const desired = { south: 49.2, north: 52.8, west: 36.2, east: 43.8 };
  assert.deepEqual(uncoveredViewportBounds(loaded, desired), []);
});

test("map requests only newly exposed strips after a shift", () => {
  const loaded = { south: 49, north: 53, west: 36, east: 44 };
  const desired = { south: 50, north: 54, west: 37, east: 45 };
  assert.deepEqual(uncoveredViewportBounds(loaded, desired), [
    { south: 53, north: 54, west: 37, east: 45 },
    { south: 50, north: 53, west: 44, east: 45 },
  ]);
});

test("map requests the whole padded viewport after a distant jump", () => {
  const desired = { south: 60, north: 62, west: 70, east: 72 };
  assert.deepEqual(uncoveredViewportBounds({ south: 49, north: 53, west: 36, east: 44 }, desired), [desired]);
});

test("uses a text-only Leaflet attribution prefix", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) => readFile(
    new URL("./public/station-map.js", import.meta.url),
    "utf8",
  ));

  assert.match(source, /attributionControl\.setPrefix\('<a href="https:\/\/leafletjs\.com"[^>]*>Leaflet<\/a>'\)/);
});

test("viewport refresh reconciles markers without destroying an open popup", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) => readFile(
    new URL("./public/station-map.js", import.meta.url),
    "utf8",
  ));
  const renderMarkers = source.match(/function renderMarkers\(\) \{([\s\S]*?)\n  \}\n\n  function cancelViewportLoad/)?.[1] || "";

  assert.doesNotMatch(renderMarkers, /markers\.clearLayers\(\)/);
  assert.match(renderMarkers, /markerCache\.get\(key\)/);
  assert.match(renderMarkers, /markers\.removeLayer\(marker\)/);
  assert.match(renderMarkers, /markers\.addLayers\(added\)/);
  assert.match(source, /visible\.length \|\| !viewportStations\.length \|\| activePopupStationKey/);
});
