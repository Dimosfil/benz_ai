import test from "node:test";
import assert from "node:assert/strict";
import {
  selectionStatus,
  stationConfidence,
  stationFreshText,
  stationFuelEntries,
  stationLastPaymentAt,
  minimumPrice,
} from "./public/station-view.js";

test("station fuel entries combine availability and prices", () => {
  const entries = stationFuelEntries({
    fuelStatus: { 92: "available", DT: "not_available" },
    prices: { 95: { value: 68.5 }, 92: { value: 64 } },
  });

  assert.deepEqual(entries.map(({ type, status, price }) => ({ type, status, price })), [
    { type: "92", status: "maybe_available", price: 64 },
    { type: "95", status: "no_data", price: 68.5 },
    { type: "DT", status: "not_available", price: null },
  ]);
});

test("minimum price ignores invalid and nonpositive values", () => {
  assert.equal(minimumPrice({ prices: { 92: { value: 0 }, 95: { value: -1 }, DT: { value: 71.5 } } }), 71.5);
  assert.equal(minimumPrice({ prices: { 92: { value: "bad" } } }), null);
});

test("station confidence reports agreement between known source signals", () => {
  const station = {
    overallStatus: "available",
    fuelStatus: { 92: "available" },
    availabilityBySource: {
      tbank: { overallStatus: "available", fuelStatus: { 92: "available" } },
      alfa: { overallStatus: "available", fuelStatus: { 92: "available" } },
      sber: { overallStatus: "no_data", fuelStatus: { 92: "no_data" } },
    },
  };

  assert.deepEqual(stationConfidence(station), { matching: 2, total: 2, percent: 100 });
  assert.deepEqual(stationConfidence(station, ["92"]), { matching: 2, total: 2, percent: 100 });
});

test("station confidence stays hidden when no source has availability evidence", () => {
  assert.equal(stationConfidence({
    overallStatus: "no_data",
    fuelStatus: {},
    availabilityBySource: { sber: { overallStatus: "no_data", fuelStatus: {} } },
  }), null);
});

test("station confidence reflects disagreement between sources", () => {
  assert.deepEqual(stationConfidence({
    overallStatus: "maybe_available",
    fuelStatus: { 95: "maybe_available" },
    availabilityBySource: {
      tbank: { overallStatus: "available", fuelStatus: { 95: "available" } },
      gdebenz: { overallStatus: "not_available", fuelStatus: { 95: "not_available" } },
    },
  }), { matching: 1, total: 2, percent: 50 });
});

test("uses green only for strongly confirmed availability", () => {
  const oneSignal = {
    overallStatus: "available",
    fuelStatus: { 92: "available" },
    availabilityBySource: {
      alfa: { overallStatus: "available", fuelStatus: { 92: "available" } },
    },
  };
  const twoSignals = {
    ...oneSignal,
    availabilityBySource: {
      ...oneSignal.availabilityBySource,
      sber: { overallStatus: "available", fuelStatus: { 92: "available" } },
    },
  };

  assert.equal(selectionStatus(oneSignal), "maybe_available");
  assert.equal(selectionStatus(oneSignal, ["92"]), "maybe_available");
  assert.equal(selectionStatus(twoSignals), "available");
  assert.equal(selectionStatus(twoSignals, ["92"]), "available");
});

test("keeps a 50 percent signal yellow", () => {
  assert.equal(selectionStatus({
    overallStatus: "maybe_available",
    fuelStatus: { 95: "maybe_available" },
    availabilityBySource: {
      tbank: { overallStatus: "available", fuelStatus: { 95: "available" } },
      gdebenz: { overallStatus: "not_available", fuelStatus: { 95: "not_available" } },
    },
  }), "maybe_available");
});

test("shows the latest bank payment without treating a crowd report as payment", () => {
  const station = {
    availabilityBySource: {
      alfa: { observedAt: "2026-07-15T10:00:00.000Z" },
      sber: { observedAt: "2026-07-15T11:30:00.000Z" },
      gdebenz: { observedAt: "2026-07-15T12:00:00.000Z" },
    },
    priceUpdatedAt: null,
  };

  assert.equal(stationLastPaymentAt(station), "2026-07-15T11:30:00.000Z");
  assert.match(stationFreshText(station), /^Последняя оплата: /);
});
