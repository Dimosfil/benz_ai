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

for (const hasOrganizationId of [true, false]) test(`opening a popup fills prices with organization ID ${hasOrganizationId}, preserves snapshots and ignores a removed marker`, async (t) => {
  const clock = Date.now();
  t.mock.timers.enable({ apis: ["Date"], now: clock });
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
    const query = new URL(url, "http://localhost").searchParams;
    assert.equal(query.get("yandexOrgId"), hasOrganizationId || calls > 0 ? "38745431337" : null);
    assert.equal(query.get("lat"), "51.69258");
    assert.equal(query.get("lon"), "39.377016");
    assert.equal(query.get("name"), "Газпром");
    calls++;
    return new Promise((resolve) => { resolveRequest = resolve; });
  };
  const view = createStationMap({ container: {}, message: node(), count: node() });
  const station = { name: "Газпром", lat: 51.69258, lon: 39.377016,
    sourceRefs: [{ source: "sber", externalId: "one" }], yandexOrgId: hasOrganizationId ? "38745431337" : null,
    overallStatus: "available", fuelStatus: { 92: "available" }, prices: {},
    availabilityBySource: { tbank: { overallStatus: "available", fuelStatus: { 92: "available" }, observedAt: new Date(Date.now() - 20 * 60_000).toISOString() } } };
  const prices = { 92: { value: 64.95, currency: "RUB", source: "yandex" } };
  try {
    view.showStations([station], { preserveStations: true });
    const marker = created[0];
    marker.open();
    assert.match(marker.popup.className, /map-popup-maybe_available/);
    assert.match(content(marker.popup.children[1]), /Последняя операция по данным T‑Bank Fuel/);
    assert.match(content(marker.popup.children[1]), /Работа колонок сейчас не подтверждена/);
    assert.match(content(marker.popup.children[1]), /Во время слива топлива обслуживание может быть приостановлено/);
    assert.doesNotMatch(content(marker.popup), /оплата подтверждает наличие/);
    assert.match(content(marker.popup), /[Пп]роверяем цены/);
    assert.doesNotMatch(content(marker.popup), /не передают цены/);
    resolveRequest(Response.json({ yandexOrgId: "38745431337", prices, priceUpdatedAt: "15 сентября 2026" }));
    await new Promise((resolve) => setImmediate(resolve));
    assert.match(content(marker.popup), /64,95/);
    assert.match(content(marker.popup), /Цены получены/);
    assert.match(content(marker.popup), /Возможно есть/);
    view.showStations([station], { preserveStations: true });
    assert.equal(calls, 1);
    marker.open();
    assert.match(content(marker.popup), /64,95/);
    resolveRequest(Response.json({ prices, stationClosed: true }));
    await new Promise((resolve) => setImmediate(resolve));
    assert.match(content(marker.popup), /АЗС как закрытую/);
    marker.open();
    resolveRequest(Response.json({ error: "Ответ Яндекса не содержит распознаваемых данных о ценах" }, { status: 503 }));
    await new Promise((resolve) => setImmediate(resolve));
    assert.match(content(marker.popup), /не содержит распознаваемых/);
    assert.match(content(marker.popup), /64,95/);
    assert.doesNotMatch(content(marker.popup), /цены не опубликованы/);

    const at = (minutes) => new Date(clock - minutes * 60_000).toISOString();
    const pairStation = { ...station, availabilityBySource: {
      tbank: { overallStatus: "available", fuelStatus: { 92: "available" }, observedAt: at(5), paymentTimes: [at(5)] },
      alfa: { overallStatus: "available", fuelStatus: { 92: "available" }, observedAt: at(20), paymentTimes: [at(20)] },
    } };
    const beforeAgeRefresh = calls;
    view.showStations([pairStation], { preserveStations: true });
    view.refreshEvidence();
    assert.equal(marker.options.stationStatus, "available");
    assert.match(content(marker.popup), /Две разные операции по данным T‑Bank Fuel и Alfa AZS/);
    const stopped = { ...pairStation, availabilityBySource: { ...pairStation.availabilityBySource,
      gdebenz: { overallStatus: "no_data", serviceStatus: "paused", serviceObservedAt: at(2), serviceReason: "Слив топлива" },
    } };
    view.showStations([stopped], { preserveStations: true });
    view.refreshEvidence();
    assert.equal(marker.options.stationStatus, "maybe_available");
    assert.match(content(marker.popup), /Обслуживание приостановлено/);
    assert.match(content(marker.popup), /Слив топлива · ГдеБЕНЗ/);
    view.showStations([{ ...pairStation, availabilityBySource: { ...pairStation.availabilityBySource,
      gdebenz: { overallStatus: "no_data", serviceStatus: "operating", serviceObservedAt: at(1) },
    } }], { preserveStations: true });
    view.refreshEvidence();
    assert.equal(marker.options.stationStatus, "available");
    t.mock.timers.tick(31 * 60_000);
    view.refreshEvidence();
    assert.equal(marker.options.stationStatus, "maybe_available");
    assert.doesNotMatch(content(marker.popup), /Две разные операции/);
    assert.equal(calls, beforeAgeRefresh, "age refresh must not poll providers or prices");
    marker.open();
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
