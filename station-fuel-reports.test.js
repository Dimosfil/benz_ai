import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mergeStations } from "./domain/stations.js";
import { StationFuelReports } from "./services/station-fuel-reports.js";
import { FUEL_REPORT_MAX_AGE_MS, reportedFuelStatus } from "./public/fuel-reports.js";
import { selectionStatus, stationConfidence, stationFuelReportText } from "./public/station-view.js";
import { mergeStationCache } from "./public/station-map.js";
import { once } from "node:events";
import { startServer } from "./server.js";

const at = (now, minutes) => new Date(now - minutes * 60_000).toISOString();
function station(now = Date.now()) {
  const signal = { overallStatus: "available", fuelStatus: { 92: "available", 95: "available", DT: "available" }, observedAt: at(now, 10) };
  return { name: "Тестовая АЗС", address: "Тестовый адрес", lat: 51, lon: 39,
    sourceRefs: [{ source: "gdebenz", externalId: "one" }, { source: "tbank", externalId: "two" }],
    prices: { 92: { value: 65, currency: "RUB" } },
    availabilityBySource: { gdebenz: signal, yandex: { ...signal, confirmations: 2 },
      tbank: { ...signal, paymentTimes: [at(now, 10), at(now, 20)] } } };
}
function report(now, fuels = ["92", "95"]) {
  return { sourceRefs: station(now).sourceRefs, fuels, status: "not_available", observedAt: at(now, 1) };
}

test("on-site petrol report beats old availability and payments, preserves diesel and prices", () => {
  const now = Date.now();
  const original = station(now);
  const [value] = mergeStations([{ ...original, fuelReports: [report(now)] }]);
  assert.equal(value.overallStatus, "maybe_available");
  for (const fuel of ["92", "95"]) {
    assert.equal(value.fuelStatus[fuel], "not_available");
    assert.equal(selectionStatus(value, [fuel]), "not_available");
  }
  assert.equal(selectionStatus(value, ["92", "95"]), "not_available");
  assert.equal(selectionStatus(value, ["DT"]), "available");
  assert.equal(selectionStatus(value, ["92", "DT"]), "maybe_available");
  assert.equal(selectionStatus(value, ["92", "CNG"]), "maybe_available");
  assert.equal(stationConfidence(value), null);
  assert.match(stationFuelReportText(value), /Сообщение посетителя.*АИ‑92.*АИ‑95.*МСК/);
  assert.deepEqual(value.prices, original.prices);
  assert.equal(original.availabilityBySource.gdebenz.fuelStatus[92], "available");
});

test("only a later direct per-grade confirmation supersedes a report; newer bank activity does not", () => {
  const now = Date.now();
  const value = station(now);
  value.fuelReports = [report(now)];
  value.availabilityBySource.tbank.observedAt = at(now, 0.2);
  assert.equal(reportedFuelStatus(value, "92", now), "not_available");
  value.availabilityBySource.yandex = { overallStatus: "available", fuelStatus: { 92: "available" }, confirmations: 1, observedAt: at(now, 0.5) };
  assert.equal(reportedFuelStatus(value, "92", now), "not_available");
  value.availabilityBySource.yandex.confirmations = 2;
  const [merged] = mergeStations([value]);
  assert.equal(merged.fuelStatus[92], "available");
  assert.equal(selectionStatus(merged, ["92"]), "available");
  assert.equal(selectionStatus(merged, ["95"]), "not_available");
  value.availabilityBySource.yandex.observedAt = at(now, -1);
  assert.equal(reportedFuelStatus(value, "92", now), "not_available");
});

test("reports expire at one hour on server and client; no stale red survives age refresh", (t) => {
  const now = Date.now();
  t.mock.timers.enable({ apis: ["Date"], now });
  const value = station(now);
  value.fuelReports = [{ ...report(now), observedAt: at(now, 0) }];
  const [merged] = mergeStations([value]);
  assert.equal(selectionStatus(merged, ["92"]), "not_available");
  t.mock.timers.tick(FUEL_REPORT_MAX_AGE_MS);
  assert.equal(selectionStatus(merged, ["92"]), "maybe_available");
  assert.equal(mergeStations([merged])[0].fuelStatus[92], "maybe_available");
  assert.equal(stationFuelReportText(merged), "");
  value.fuelReports[0].observedAt = at(Date.now(), -1);
  assert.equal(reportedFuelStatus(value, "92"), null);
});

test("older map snapshots cannot erase a fresh report; later baseline is used after expiry", (t) => {
  const now = Date.now();
  t.mock.timers.enable({ apis: ["Date"], now });
  const cache = new Map(), identities = new Map(), keys = new WeakMap();
  const [fresh] = mergeStations([{ ...station(now), fuelReports: [{ ...report(now), observedAt: at(now, 0) }] }]);
  mergeStationCache(cache, identities, keys, [fresh]);
  mergeStationCache(cache, identities, keys, mergeStations([station(now)]));
  assert.equal(selectionStatus([...cache.values()][0], ["92"]), "not_available");
  t.mock.timers.tick(FUEL_REPORT_MAX_AGE_MS);
  const updated = station(Date.now());
  mergeStationCache(cache, identities, keys, mergeStations([updated]));
  assert.equal(selectionStatus([...cache.values()][0], ["92"]), "available");
});

async function storage(t) {
  const dir = await mkdtemp(join(tmpdir(), "benz-fuel-reports-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return join(dir, "reports.json");
}

test("reports persist, attach by provider aliases, isolate neighbours and retain another grade's timestamp", async (t) => {
  const file = await storage(t);
  const now = Date.now();
  const store = new StationFuelReports({ file });
  await store.ready;
  const base = station(now);
  store.attach([base]);
  // Partial snapshots can replace one alias while another still points at an older merged snapshot.
  store.attach([{ ...base, sourceRefs: [base.sourceRefs[0]] }]);
  const payload = { sourceRefs: base.sourceRefs, fuels: ["95"], checkedOnSite: true, observedAt: "2099-01-01" };
  await store.submit(payload, now - 5 * 60_000);
  const saved = await store.submit({ ...payload, fuels: ["92"] }, now);
  assert.equal(saved.fuelReports.length, 2);
  assert.equal(saved.fuelReports.find((item) => item.fuels.includes("95")).observedAt, at(now, 5));
  const disk = JSON.parse(await readFile(file, "utf8"));
  assert.equal(disk.reports[1].observedAt, at(now, 0));
  const restored = new StationFuelReports({ file });
  await restored.ready;
  const [alias, neighbour] = restored.attach([
    { ...base, sourceRefs: [{ source: "tbank", externalId: "two" }] },
    { ...base, sourceRefs: [{ source: "tbank", externalId: "neighbour" }] },
  ]);
  assert.equal(alias.fuelReports.length, 2);
  assert.equal(neighbour.fuelReports, undefined);
  assert.equal(restored.attach([base], now + FUEL_REPORT_MAX_AGE_MS)[0].fuelReports, undefined);
});

test("report submissions reject unknown identity, unchecked reports, diesel, duplicate grades and malformed input", async (t) => {
  const store = new StationFuelReports({ file: await storage(t) });
  await store.ready;
  const base = station();
  store.attach([base]);
  const payload = { sourceRefs: base.sourceRefs, fuels: ["92", "95"], checkedOnSite: true };
  for (const bad of [null, {}, { ...payload, fuels: ["DT"] }, { ...payload, fuels: ["92", "92"] },
    { ...payload, checkedOnSite: false }, { ...payload, sourceRefs: [{ source: "tbank", externalId: {} }] }]) {
    await assert.rejects(store.submit(bad), (error) => error.statusCode === 400);
  }
  await assert.rejects(store.submit({ ...payload, sourceRefs: [{ source: "tbank", externalId: "unknown" }] }), (error) => error.statusCode === 404);
  assert.equal(store.reports.length, 0);
  store.attach([{ ...base, sourceRefs: [{ source: "tbank", externalId: "neighbour" }] }]);
  await assert.rejects(store.submit({ ...payload, sourceRefs: [base.sourceRefs[0], { source: "tbank", externalId: "neighbour" }] }),
    (error) => error.statusCode === 400);
});

test("invalid optional report storage disables reporting without taking down station aggregation", async (t) => {
  const file = await storage(t);
  await writeFile(file, "invalid-json", "utf8");
  const store = new StationFuelReports({ file });
  await store.ready;
  assert.equal(store.available, false);
  const base = station();
  assert.equal(store.attach([base])[0].name, base.name);
  await assert.rejects(store.submit({}), (error) => error.statusCode === 503);
});

test("HTTP report endpoint validates origin/body, saves a known station and enforces the write rate limit", async (t) => {
  const store = new StationFuelReports({ file: await storage(t) });
  await store.ready;
  const baseStation = station();
  store.attach([baseStation]);
  const server = startServer(0, "127.0.0.1", { fuelReports: store });
  await once(server, "listening");
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); await server.waitForCleanup(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const url = `${base}/api/station-reports`;
  const options = { method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ sourceRefs: baseStation.sourceRefs, fuels: ["92", "95"], checkedOnSite: true }) };
  assert.equal((await fetch(url)).status, 405);
  assert.equal((await fetch(url, { ...options, headers: { ...options.headers, Origin: "https://external.example" } })).status, 403);
  assert.equal((await fetch(url, { ...options, headers: { "Content-Type": "text/plain" } })).status, 415);
  assert.equal((await fetch(url, { ...options, body: "{" })).status, 400);
  assert.equal((await fetch(url, { ...options, body: "x".repeat(9000) })).status, 413);
  const response = await fetch(url, options);
  assert.equal(response.status, 201);
  const data = await response.json();
  assert.equal(data.station.fuelStatus[92], "not_available");
  assert.equal(data.station.fuelStatus[95], "not_available");
  assert.equal(data.station.fuelStatus.DT, "available");
  assert.equal(data.station.name, "Тестовая АЗС");
  assert.equal((await fetch(url, options)).status, 429);
  assert.equal((await fetch(`${base}/api/health`)).status, 200);
});
