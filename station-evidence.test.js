import test from "node:test";
import assert from "node:assert/strict";
import { bankPaymentPair, latestServiceReport, serviceReportFromText } from "./public/station-evidence.js";
import { StationObservations } from "./domain/station-observations.js";
import { mergeStations } from "./domain/stations.js";
import { selectionStatus, stationFreshText, stationPaymentPairText } from "./public/station-view.js";
import { normalizeTbankStation } from "./providers/tbank.js";
import { normalizeAlfaStation } from "./providers/alfa.js";
import { normalizeSberStation } from "./providers/sber.js";
import { normalizeGdebenzStation } from "./providers/gdebenz.js";
import { parseYandexFuelAvailability } from "./providers/yandex.js";
import { streamProviderSnapshots } from "./server.js";

const NOW = Date.parse("2026-10-03T09:00:00Z");
const at = (minutes) => new Date(NOW - minutes * 60_000).toISOString();
function station(source = "tbank", id = "one", times = [at(5)]) {
  return { source, externalId: id, sourceRefs: [{ source, externalId: id }], name: "АЗС",
    lat: 55, lon: 37, overallStatus: "available", fuelStatus: { 92: "available", 95: "maybe_available" }, prices: {},
    availabilityBySource: { [source]: { overallStatus: "available", fuelStatus: { 92: "available", 95: "maybe_available" },
      observedAt: times[0], paymentTimes: times } } };
}
function freeze(t) { t.mock.timers.enable({ apis: ["Date"], now: NOW }); }
function agree(station, expected) {
  const [merged] = mergeStations([station]);
  assert.equal(merged.overallStatus, expected);
  assert.equal(selectionStatus(merged), expected);
  return merged;
}

test("two distinct purchases from the same bank turn the station green without promoting unknown grades", (t) => {
  freeze(t);
  for (const source of ["tbank", "alfa", "sber"]) {
    const merged = agree(station(source, "one", [at(5), at(20)]), "available");
    assert.equal(selectionStatus(merged, ["95"]), "maybe_available");
    assert.deepEqual(bankPaymentPair(merged.availabilityBySource).sources, [source]);
  }
});

test("distinct operations through different banks at the same station also form a pair", (t) => {
  freeze(t);
  for (const other of ["alfa", "sber"]) {
    const [combined] = mergeStations([station(), station(other, "other", [at(10)])]);
    agree(combined, "available");
    assert.deepEqual(bankPaymentPair(combined.availabilityBySource), {
      sources: ["tbank", other], times: [at(5), at(10)],
    });
    assert.match(stationPaymentPairText(combined), /T‑Bank Fuel и (Alfa|Sber) AZS/);
  }
});

test("repeated timestamps count once across banks, including different timezone formats", (t) => {
  freeze(t);
  agree(station("tbank", "one", [at(5), at(5)]), "maybe_available");
  const combined = station();
  combined.availabilityBySource.alfa = station("alfa", "other", ["2026-10-03T11:55:00+03:00"]).availabilityBySource.alfa;
  assert.equal(bankPaymentPair(combined.availabilityBySource), null);
  agree(combined, "maybe_available");
  combined.availabilityBySource.sber = station("sber", "third", [at(20)]).availabilityBySource.sber;
  agree(combined, "available");
  assert.deepEqual(bankPaymentPair(combined.availabilityBySource).times, [at(5), at(20)]);
});

test("both event times must be inside the last thirty minutes, including the exact boundary", (t) => {
  freeze(t);
  const value = station("tbank", "one", [at(5), at(30)]);
  const mixed = station();
  mixed.availabilityBySource.alfa = station("alfa", "other", [at(30)]).availabilityBySource.alfa;
  agree(value, "available");
  agree(mixed, "available");
  t.mock.timers.tick(1);
  agree(value, "maybe_available");
  agree(mixed, "maybe_available");
  agree(station("tbank", "old", [at(40), at(55)]), "maybe_available");
  agree(station("tbank", "future", [at(-1), at(5)]), "maybe_available");
});

test("request snapshots accumulate only two times and do not mutate provider caches", (t) => {
  freeze(t);
  const history = new StationObservations();
  const first = station("tbank", "one", [at(20)]);
  const snapshot = history.observe([first])[0];
  agree(snapshot, "maybe_available");
  const next = history.observe([station("tbank", "one", [at(5)])])[0];
  agree(next, "available");
  assert.deepEqual(first.availabilityBySource.tbank.paymentTimes, [at(20)]);
  const duplicate = history.observe([station("tbank", "one", [at(5)])])[0];
  assert.deepEqual(duplicate.availabilityBySource.tbank.paymentTimes, [at(5), at(20)]);
  const newer = history.observe([station("tbank", "one", [at(1)])])[0];
  assert.deepEqual(newer.availabilityBySource.tbank.paymentTimes, [at(1), at(5)]);
  t.mock.timers.tick(31 * 60_000);
  agree(history.observe([newer])[0], "maybe_available");
  assert.equal(history.records.size, 0);
});

test("history is isolated by station and bank, has a size bound and is empty after restart", (t) => {
  freeze(t);
  const history = new StationObservations({ maxStations: 2 });
  history.observe([station("tbank", "one", [at(20)])]);
  agree(history.observe([station("sber", "one", [at(5)])])[0], "maybe_available");
  agree(history.observe([station("tbank", "two", [at(5)])])[0], "maybe_available");
  assert.equal(history.records.size, 2);
  assert.equal(history.records.has("tbank:one"), false);
  agree(new StationObservations().observe([station()])[0], "maybe_available");
});

test("T-Bank events, Alfa per-fuel dates and Sber last payment feed the same bounded policy", (t) => {
  freeze(t);
  const bank = normalizeTbankStation({ id: "one", name: "АЗС", lat: 55, lon: 37,
    status: "available", lastTransactionAt: at(5), recentEvents: [
      { type: "transaction", lastUpdatedAt: at(20) },
      { type: "transaction", lastUpdatedAt: at(5) },
      { type: "report", lastUpdatedAt: at(10) }, null,
      { type: "transaction", lastUpdatedAt: at(-1) },
    ] });
  assert.deepEqual(bank.availabilityBySource.tbank.paymentTimes, [at(5), at(20)]);
  agree(bank, "available");
  const alfa = normalizeAlfaStation({ station_id: "one", address: { location: { latitude: 55, longitude: 37 } },
    fuels: [{ category: "AI92", status: "available", last_transaction_at: at(5) },
      { category: "AI95", status: "available", last_transaction_at: at(20) }] });
  assert.deepEqual(alfa.availabilityBySource.alfa.paymentTimes, [at(5), at(20)]);
  agree(alfa, "available");
  const sber = normalizeSberStation({ id: "one", availabilityStatus: "available", lastPaymentAt: at(5),
    location: { lat: 55, lon: 37 } });
  agree(sber, "maybe_available");
});

test("a newer negative report suppresses the pair while an older negative does not", (t) => {
  freeze(t);
  const value = station();
  value.availabilityBySource.alfa = station("alfa", "other", [at(20)]).availabilityBySource.alfa;
  value.availabilityBySource.yandex = { overallStatus: "not_available", observedAt: at(2) };
  agree(value, "maybe_available");
  value.availabilityBySource.yandex.observedAt = at(10);
  agree(value, "available");
});

test("a fresh unloading report overrides payments and crowd confirmations without declaring no fuel", (t) => {
  freeze(t);
  const value = station();
  value.availabilityBySource.sber = station("sber", "other", [at(20)]).availabilityBySource.sber;
  value.availabilityBySource.yandex = { overallStatus: "available", observedAt: at(1), confirmations: 3,
    fuelStatus: { 92: "available" } };
  value.availabilityBySource.gdebenz = { overallStatus: "available", observedAt: at(2),
    ...serviceReportFromText("Идёт слив топлива", at(2)) };
  const merged = agree(value, "maybe_available");
  assert.equal(merged.serviceStatus, "paused");
  assert.equal(merged.fuelStatus["92"], "maybe_available");
  assert.equal(selectionStatus(merged, ["92"]), "maybe_available");
  assert.match(stationFreshText(merged), /Слив топлива · ГдеБЕНЗ · 2 мин назад/);
});

test("stop reports survive another snapshot, only a newer resumption or expiry clears them", (t) => {
  freeze(t);
  const history = new StationObservations();
  const stopped = station("gdebenz");
  Object.assign(stopped.availabilityBySource.gdebenz, serviceReportFromText("Слив топлива", at(2)));
  history.observe([stopped]);
  const withoutReport = history.observe([station("gdebenz")])[0];
  assert.equal(latestServiceReport(withoutReport.availabilityBySource).status, "paused");
  const resumed = station("gdebenz");
  Object.assign(resumed.availabilityBySource.gdebenz, serviceReportFromText("Обслуживание возобновлено", at(1)));
  assert.equal(latestServiceReport(history.observe([resumed])[0].availabilityBySource).status, "operating");
  t.mock.timers.tick(61 * 60_000);
  assert.equal(latestServiceReport(history.observe([resumed])[0].availabilityBySource), null);
});

test("providers recognize explicit service reports and ignore undated, future and completed unloading", (t) => {
  freeze(t);
  const crowd = normalizeGdebenzStation({ osm_id: "one", lat: 55, lon: 37, status: "yes",
    fuels_now: "92", detail: "Слив топлива", last_at: at(2) });
  assert.equal(latestServiceReport(crowd.availabilityBySource).status, "paused");
  const yandex = parseYandexFuelAvailability('<div class="gas-station-fuel-card-view__title">Топливо в наличии · обслуживание приостановлено</div>Обновлено 2 мин назад', NOW);
  assert.equal(latestServiceReport({ yandex }).status, "paused");
  for (const time of [null, "invalid", at(-1), at(61)]) {
    assert.equal(latestServiceReport({ gdebenz: serviceReportFromText("Слив топлива", time) }), null);
  }
  assert.equal(serviceReportFromText("Слив завершён", at(1)).serviceStatus, "operating");
  assert.deepEqual(serviceReportFromText("Слива топлива нет", at(1)), {});
  const bank = normalizeTbankStation({ id: "reported-stop", status: "available", lastTransactionAt: at(5),
    recentEvents: [{ type: "report", text: "Обслуживание приостановлено", lastUpdatedAt: at(2) }] });
  assert.equal(latestServiceReport(bank.availabilityBySource).status, "paused");
});

test("successive requested viewport streams retain payment observations", async (t) => {
  freeze(t);
  const id = "stream-pair-regression";
  const first = [];
  await streamProviderSnapshots([{ source: "T-Bank", promise: Promise.resolve({ stations: [station("tbank", id, [at(20)])] }) }], (snapshot) => first.push(snapshot));
  assert.equal(first.at(-1).stations[0].overallStatus, "maybe_available");
  const second = [];
  await streamProviderSnapshots([{ source: "T-Bank", promise: Promise.resolve({ stations: [station("tbank", id, [at(5)])] }) }], (snapshot) => second.push(snapshot));
  assert.equal(second.at(-1).stations[0].overallStatus, "available");
});
