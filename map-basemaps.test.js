import test from "node:test";
import assert from "node:assert/strict";
import { createBasemapSwitcher } from "./public/map-basemaps.js";

function fixture(loadVector = async () => {}) {
  const stationLayer = {};
  const layers = new Set([stationLayer]);
  const notices = [];
  const saved = [];
  const vectors = [];
  const map = { removeLayer(layer) { layers.delete(layer); } };
  const L = {
    tileLayer(url, options) { return { url, options, addTo() { layers.add(this); } }; },
    maplibreGL(options) {
      const handlers = new Map();
      const gl = { on(event, fn) { handlers.set(event, fn); }, off(event) { handlers.delete(event); } };
      const layer = { options, addTo() { layers.add(this); }, getMaplibreMap: () => gl,
        emit(event) { handlers.get(event)?.(); } };
      vectors.push(layer);
      return layer;
    },
  };
  const switcher = createBasemapSwitcher({ L, map, loadVector, notify: (...args) => notices.push(args),
    storage: { setItem: (...args) => saved.push(args) } });
  return { switcher, layers, stationLayer, notices, saved, vectors };
}

test("raster selection keeps stations and exactly one base layer without loading vector libraries", async () => {
  const f = fixture(() => { throw Error("must remain lazy"); });
  await f.switcher.select("topo");
  assert.equal(f.switcher.selected, "topo");
  assert.equal(f.layers.size, 2);
  assert.ok(f.layers.has(f.stationLayer));
  assert.match([...f.layers][1].url, /tile.opentopomap/);
  await f.switcher.select("unknown");
  assert.equal(f.switcher.selected, "osm");
  assert.equal(f.layers.size, 2);
});

test("a slow library download cannot override a newer raster selection", async () => {
  let finish;
  const f = fixture(() => new Promise((resolve) => { finish = resolve; }));
  const pending = f.switcher.select("bright");
  await f.switcher.select("topo");
  finish(); await pending;
  assert.equal(f.switcher.selected, "topo");
  assert.equal(f.vectors.length, 0);
});

test("vector selection persists after load and cancels cleanly when switched away", async () => {
  const f = fixture();
  const pending = f.switcher.select("liberty");
  await Promise.resolve();
  f.vectors[0].emit("load"); await pending;
  assert.equal(f.switcher.selected, "liberty");
  assert.deepEqual(f.saved.at(-1), ["benz.map-style", "liberty"]);
  const second = f.switcher.select("positron");
  await Promise.resolve();
  await f.switcher.select("osm"); await second;
  assert.equal(f.layers.size, 2);
  assert.ok(f.layers.has(f.stationLayer));
  assert.equal(f.switcher.selected, "osm");
});

test("network/style failure restores OSM and explains the failure", async () => {
  const f = fixture();
  const pending = f.switcher.select("bright");
  await Promise.resolve();
  f.vectors[0].emit("error"); await pending;
  assert.equal(f.switcher.selected, "osm");
  assert.equal(f.layers.size, 2);
  assert.match(f.notices.at(-1)[1], /Не удалось/);
  const broken = fixture(async () => { throw Error("offline"); });
  await broken.switcher.select("liberty");
  assert.equal(broken.switcher.selected, "osm");
});
