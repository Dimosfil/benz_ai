import test from "node:test";
import assert from "node:assert/strict";
import {
  clusterStatusChart,
  hasMapCoordinates,
  mergeStationCache,
  padViewportBounds,
  stationMapStatus,
  stationViewportUrl,
  stationWithinBounds,
  supportsViewportZoom,
  territoryMapBounds,
  uncoveredViewportBounds,
} from "./public/station-map.js";

test("stream snapshots update one cached station when its preferred name changes", () => {
  const cache = new Map();
  const identityIndex = new Map();
  const stationKeys = new WeakMap();
  const first = {
    name: "АЗС № 12",
    lat: 51.6845,
    lon: 39.4849,
    sourceRefs: [{ source: "tbank", externalId: "station-12" }],
  };
  const enriched = {
    ...first,
    name: "Интрансгаз",
    sourceRefs: [
      ...first.sourceRefs,
      { source: "multigo", externalId: "station-98" },
    ],
  };

  mergeStationCache(cache, identityIndex, stationKeys, [first]);
  const originalKey = stationKeys.get(first);
  mergeStationCache(cache, identityIndex, stationKeys, [enriched]);

  assert.equal(cache.size, 1);
  assert.equal(stationKeys.get(enriched), originalKey);
  assert.equal(cache.get(originalKey).name, "Интрансгаз");
  assert.equal(identityIndex.get("source:multigo:station-98"), originalKey);
});

test("final summary reconciliation preserves stations already streamed to the map", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) => readFile(
    new URL("./public/station-map.js", import.meta.url),
    "utf8",
  ));
  const showStations = source.match(/function showStations\(stations,[\s\S]*?\) \{([\s\S]*?)\n  \}\n\n  function deactivate/)?.[1] || "";

  assert.match(showStations, /if \(!preserveStations\) \{[\s\S]*?stationCache\.clear\(\)/);
  assert.match(showStations, /renderMarkers\(\);\s+if \(preserveStations\) return;/);
});

test("map cache does not duplicate one Multigo station when its raw id changes", () => {
  const cache = new Map();
  const identityIndex = new Map();
  const stationKeys = new WeakMap();
  const base = {
    source: "multigo",
    name: "АЗС №36701",
    address: "г. Воронеж, ул. Холмистая, 62",
    lat: 51.66784421,
    lon: 39.12648797,
  };

  mergeStationCache(cache, identityIndex, stationKeys, [{
    ...base,
    sourceRefs: [{ source: "multigo", externalId: "old" }],
  }]);
  mergeStationCache(cache, identityIndex, stationKeys, [{
    ...base,
    sourceRefs: [{ source: "multigo", externalId: "new" }],
  }]);

  assert.equal(cache.size, 1);
  assert.equal(identityIndex.get("source:multigo:old"), identityIndex.get("source:multigo:new"));
});

test("map cache merges address variants but keeps neighbouring stations separate", () => {
  const cache = new Map();
  const identityIndex = new Map();
  const stationKeys = new WeakMap();
  mergeStationCache(cache, identityIndex, stationKeys, [{
    name: "Лукойл",
    address: "ул. Холмистая, 62",
    lat: 51.66801835,
    lon: 39.12682576,
    sourceRefs: [{ source: "tbank", externalId: "bank" }],
  }]);
  mergeStationCache(cache, identityIndex, stationKeys, [{
    name: "АЗС №36701",
    address: "г. Воронеж, ул. Холмистая, 62",
    lat: 51.66784421,
    lon: 39.12648797,
    sourceRefs: [{ source: "multigo", externalId: "catalog" }],
  }, {
    name: "Газпромнефть",
    address: "ул. Героев Сибиряков, 2",
    lat: 51.66759632,
    lon: 39.12542242,
    sourceRefs: [{ source: "gdebenz", externalId: "other" }],
  }]);

  assert.equal(cache.size, 2);
});

test("partial stream snapshots preserve prices from the full summary", () => {
  const cache = new Map();
  const identityIndex = new Map();
  const stationKeys = new WeakMap();
  const full = {
    name: "АЗС",
    lat: 55,
    lon: 37,
    sourceRefs: [{ source: "tbank", externalId: "one" }, { source: "yandex", externalId: "two" }],
    prices: { 95: { value: 70, currency: "RUB", source: "yandex" } },
    priceUpdatedAt: "сегодня",
  };
  const partial = { ...full, sourceRefs: [full.sourceRefs[0]], prices: {}, priceUpdatedAt: null };
  mergeStationCache(cache, identityIndex, stationKeys, [full]);
  mergeStationCache(cache, identityIndex, stationKeys, [partial]);
  const merged = [...cache.values()][0];
  assert.equal(merged.prices["95"].value, 70);
  assert.equal(merged.priceUpdatedAt, "сегодня");
  assert.equal(merged.sourceRefs.length, 2);
});

test("an older map snapshot cannot overwrite a newer price", () => {
  const cache = new Map();
  const identityIndex = new Map();
  const stationKeys = new WeakMap();
  const base = { name: "АЗС", lat: 55, lon: 37, sourceRefs: [{ source: "tbank", externalId: "one" }] };
  mergeStationCache(cache, identityIndex, stationKeys, [{
    ...base,
    prices: { 95: { value: 70, currency: "RUB" } },
    priceUpdatedAt: "2026-07-18T10:00:00Z",
  }]);
  mergeStationCache(cache, identityIndex, stationKeys, [{
    ...base,
    prices: { 95: { value: 60, currency: "RUB" } },
    priceUpdatedAt: "2026-07-17T10:00:00Z",
  }]);
  assert.equal([...cache.values()][0].prices["95"].value, 70);
});

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

test("map converts a searched territory bbox to Leaflet bounds", () => {
  assert.deepEqual(territoryMapBounds({
    bbox: { minLat: 51.5402, maxLat: 51.7149, minLon: 39.0132, maxLon: 39.2031 },
  }), [[51.5402, 39.0132], [51.7149, 39.2031]]);
  assert.equal(territoryMapBounds({ bbox: { minLat: 52, maxLat: 51, minLon: 39, maxLon: 40 } }), null);
  assert.equal(territoryMapBounds(null), null);
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
  assert.equal(url.pathname, "/api/stations/stream");
  assert.equal(url.searchParams.get("mode"), "viewport");
  assert.equal(url.searchParams.get("minLat"), "51.500000");
  assert.equal(url.searchParams.get("maxLon"), "39.400000");
});

test("map loads stations only at a detailed enough zoom", () => {
  assert.equal(supportsViewportZoom(7), false);
  assert.equal(supportsViewportZoom(8), true);
  assert.equal(supportsViewportZoom(13), true);
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

test("opening station information keeps the popup inside the map viewport", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) => readFile(
    new URL("./public/station-map.js", import.meta.url),
    "utf8",
  ));

  assert.match(source, /bindPopup\([\s\S]*?autoPan: true,/);
  assert.match(source, /keepInView: true,/);
  assert.match(source, /maxHeight: Math\.max\(240, map\.getSize\(\)\.y - 96\),/);
});

test("a lone availability source explains the yellow status instead of showing 100 percent agreement", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) => readFile(
    new URL("./public/station-map.js", import.meta.url),
    "utf8",
  ));

  assert.match(source, /confidence && confidence\.total >= 2/);
  assert.match(source, /confidence\?\.total === 1/);
  assert.match(source, /Есть только один актуальный сигнал о наличии/);
});

test("map activation cancels stale hidden requests before loading the visible viewport", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) => readFile(
    new URL("./public/station-map.js", import.meta.url),
    "utf8",
  ));
  const activation = source.match(/function activate\(focus = null\) \{([\s\S]*?)\n  \}\n\n  return/)?.[1] || "";

  assert.match(activation, /deactivate\(\)/);
  assert.match(activation, /loadedBounds = null/);
  assert.match(activation, /invalidateSize\(\{ pan: false \}\)/);
  assert.match(activation, /focusSelection\(focus\)/);
  assert.match(activation, /if \(!supportsViewportZoom\(map\.getZoom\(\)\)\) \{[\s\S]*?enterLowZoomMode\(\);[\s\S]*?return;/);
  assert.match(activation, /renderMarkers\(\{ loading: true \}\)/);
  assert.match(activation, /scheduleViewportLoad\(\{ immediate: true \}\)/);
  assert.match(source, /mergeStations\(stations\);\s+if \(deferViewportLoad\) return;/);
});

test("an empty station result focuses the searched territory instead of keeping the old map view", async () => {
  const mapSource = await import("node:fs/promises").then(({ readFile }) => readFile(
    new URL("./public/station-map.js", import.meta.url),
    "utf8",
  ));
  const appSource = await import("node:fs/promises").then(({ readFile }) => readFile(
    new URL("./public/app.js", import.meta.url),
    "utf8",
  ));

  assert.match(appSource, /const mapFocus = \{\s+stations:[\s\S]*?location: data\.location,/);
  assert.match(mapSource, /focusStations\(stations\)[\s\S]*?focusTerritory\(focus\?\.location\)/);
  assert.match(mapSource, /map\.fitBounds\(bounds, \{ padding: \[34, 34\], maxZoom: 13 \}\)/);
});

test("far zoom mode clears markers only when the mode is entered", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) => readFile(
    new URL("./public/station-map.js", import.meta.url),
    "utf8",
  ));
  const lowZoom = source.match(/function enterLowZoomMode\(\) \{([\s\S]*?)\n  \}\n\n  async function loadViewport/)?.[1] || "";
  const showStations = source.match(/function showStations\(stations,[\s\S]*?\) \{([\s\S]*?)\n  \}\n\n  function deactivate/)?.[1] || "";

  assert.match(lowZoom, /cancelViewportLoad\(\);\s+if \(lowZoomMode\) return;/);
  assert.match(lowZoom, /markers\.clearLayers\(\)/);
  assert.match(showStations, /if \(!supportsViewportZoom\(map\.getZoom\(\)\)\) \{[\s\S]*?enterLowZoomMode\(\);[\s\S]*?return;[\s\S]*?\}\s+renderMarkers\(\)/);
});
