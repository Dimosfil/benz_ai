import test from "node:test";
import assert from "node:assert/strict";
import { stationConfidence, stationFuelEntries } from "./public/station-view.js";

test("station fuel entries combine availability and prices", () => {
  const entries = stationFuelEntries({
    fuelStatus: { 92: "available", DT: "not_available" },
    prices: { 95: { value: 68.5 }, 92: { value: 64 } },
  });

  assert.deepEqual(entries.map(({ type, status, price }) => ({ type, status, price })), [
    { type: "92", status: "available", price: 64 },
    { type: "95", status: "no_data", price: 68.5 },
    { type: "DT", status: "not_available", price: null },
  ]);
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
