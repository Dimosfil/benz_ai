import test from "node:test";
import assert from "node:assert/strict";
import { createStationMap } from "./public/station-map.js";

function node() {
  return {
    children: [], style: {}, textContent: "",
    append(...children) { this.children.push(...children); },
    get childElementCount() { return this.children.length; },
  };
}

function content(element) {
  return [element.textContent, ...element.children.map(content)].join(" ");
}

test("opening a popup fills prices, preserves them across snapshots and ignores a removed marker", async () => {
  const originals = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch, requestAnimationFrame: globalThis.requestAnimationFrame };
  const created = [];
  const bounds = { getSouth: () => 50, getNorth: () => 53, getWest: () => 38, getEast: () => 41 };
  const map = {
    attributionControl: { setPrefix() {} }, addLayer() {}, setView() {}, addControl() {}, on() {},
    getBounds: () => bounds, getZoom: () => 13, getSize: () => ({ y: 800 }), invalidateSize() {},
  };
  globalThis.document = { createElement: node };
  globalThis.requestAnimationFrame = (fn) => fn();
  globalThis.window = { L: {
    map: () => map, tileLayer: () => ({ addTo() {} }), divIcon: (value) => value,
    Control: { extend: () => class {} },
    markerClusterGroup: () => ({ addLayers() {}, removeLayer() {}, clearLayers() {}, refreshClusters() {} }),
    marker: (_position, options) => {
      const marker = {
        options, handlers: {}, opened: false, updates: 0,
        bindPopup(factory) { this.factory = factory; return this; },
        on(event, fn) { this.handlers[event] = fn; return this; },
        isPopupOpen() { return this.opened; },
        setPopupContent(value) { this.popup = value; this.updates++; },
        setIcon() {},
        open() { this.opened = true; this.popup = this.factory(); this.handlers.popupopen(); },
      };
      created.push(marker);
      return marker;
    },
  } };
  let resolveRequest;
  let calls = 0;
  globalThis.fetch = async (url) => {
    assert.equal(url, "/api/station-prices?yandexOrgId=38745431337");
    calls++;
    return new Promise((resolve) => { resolveRequest = resolve; });
  };
  const view = createStationMap({ container: {}, message: node(), count: node() });
  const station = { name: "Газпром", lat: 51.69258, lon: 39.377016,
    sourceRefs: [{ source: "tbank", externalId: "one" }], yandexOrgId: "38745431337",
    fuelStatus: { 92: "maybe_available" }, prices: {} };
  const prices = { 92: { value: 64.95, currency: "RUB", source: "yandex" } };
  try {
    view.showStations([station], { preserveStations: true });
    const marker = created[0];
    marker.open();
    assert.match(content(marker.popup), /Проверяем цены/);
    resolveRequest(Response.json({ prices, priceUpdatedAt: "15 сентября 2026" }));
    await new Promise((resolve) => setImmediate(resolve));
    assert.match(content(marker.popup), /64,95/);
    assert.match(content(marker.popup), /Цены проверены/);
    assert.match(content(marker.popup), /Возможно есть/);
    view.showStations([station], { preserveStations: true });
    assert.equal(calls, 1);
    marker.open();
    assert.match(content(marker.popup), /64,95/);
    view.clear();
    const updates = marker.updates;
    resolveRequest(Response.json({ prices }));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(marker.updates, updates);
  } finally {
    view.clear();
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
});
