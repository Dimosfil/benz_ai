import test from "node:test";
import assert from "node:assert/strict";
import {
  selectionStatus,
  hasRecentCrowdConfirmation,
  stationConfidence,
  stationFreshText,
  stationFuelEntries,
  stationLastPaymentAt,
  stationPriceNote,
  stationPriceText,
  stationQueueText,
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

test("explains missing prices from availability-only station sources", () => {
  const station = { sourceRefs: [{ source: "gdebenz" }, { source: "sber" }], prices: {} };
  assert.equal(stationPriceText(station), "Нет данных о ценах");
  assert.equal(stationPriceNote(station), "Источники этой АЗС не передают цены.");
  assert.equal(stationPriceNote({ ...station, prices: { 92: { value: 64 } } }), "");
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
  const freshObservedAt = new Date(Date.now() - 10 * 60_000).toISOString();
  const oneSignal = {
    overallStatus: "available",
    fuelStatus: { 92: "available" },
    availabilityBySource: {
      gdebenz: { overallStatus: "available", fuelStatus: { 92: "available" }, observedAt: freshObservedAt },
    },
  };
  const twoSignals = {
    ...oneSignal,
    availabilityBySource: {
      ...oneSignal.availabilityBySource,
      sber: { overallStatus: "available", fuelStatus: { 92: "available" }, observedAt: freshObservedAt },
    },
  };

  assert.equal(selectionStatus(oneSignal), "maybe_available");
  assert.equal(selectionStatus(oneSignal, ["92"]), "maybe_available");
  assert.equal(selectionStatus(twoSignals), "available");
  assert.equal(selectionStatus(twoSignals, ["92"]), "available");
});

test("turns matching but two-hour-old positive signals yellow", () => {
  const staleObservedAt = new Date(Date.now() - 2 * 60 * 60_000).toISOString();
  const station = {
    overallStatus: "available",
    fuelStatus: { 92: "available" },
    availabilityBySource: {
      alfa: { overallStatus: "available", fuelStatus: { 92: "available" }, observedAt: staleObservedAt },
      sber: { overallStatus: "available", fuelStatus: { 92: "available" }, observedAt: staleObservedAt },
    },
  };

  assert.equal(selectionStatus(station), "maybe_available");
  assert.equal(selectionStatus(station, ["92"]), "maybe_available");
});

test("keeps a lone recent bank operation yellow without claiming current service", () => {
  const observedAt = new Date(Date.now() - 29 * 60_000).toISOString();
  const station = {
    overallStatus: "maybe_available",
    fuelStatus: { 92: "available", 95: "maybe_available", 98: "not_available" },
    availabilityBySource: {
      alfa: { overallStatus: "available", fuelStatus: { 92: "available" }, observedAt },
    },
  };

  assert.equal(selectionStatus(station), "maybe_available");
  assert.equal(selectionStatus(station, ["95"]), "maybe_available");
  assert.match(stationFreshText(station), /Alfa AZS.*29 мин назад/);
  assert.match(stationFreshText(station), /Работа колонок сейчас не подтверждена/);
});

test("turns a lone bank payment older than 30 minutes yellow", () => {
  const observedAt = new Date(Date.now() - 31 * 60_000).toISOString();
  const station = {
    overallStatus: "available",
    fuelStatus: { 92: "available" },
    availabilityBySource: {
      sber: { overallStatus: "available", fuelStatus: { 92: "available" }, observedAt },
    },
  };

  assert.equal(selectionStatus(station), "maybe_available");
});

test("shows recent corroborated Yandex availability and queue", () => {
  const observedAt = new Date(Date.now() - 28 * 60_000).toISOString();
  const station = {
    overallStatus: "available",
    fuelStatus: { 92: "maybe_available", 95: "available" },
    availabilityBySource: {
      tbank: { overallStatus: "not_available", fuelStatus: { 92: "not_available", 95: "not_available" }, observedAt },
      yandex: {
        overallStatus: "available",
        fuelStatus: { 92: "maybe_available", 95: "available" },
        observedAt,
        confirmations: 3,
        queueStatus: "high",
        queueLabel: "Большая очередь",
      },
    },
  };

  assert.equal(hasRecentCrowdConfirmation(station), true);
  assert.equal(hasRecentCrowdConfirmation(station, ["95"]), true);
  assert.equal(hasRecentCrowdConfirmation(station, ["92"]), false);
  assert.equal(selectionStatus(station), "available");
  assert.equal(selectionStatus(station, ["95"]), "available");
  assert.match(stationQueueText(station), /Большая очередь · Яндекс Карты · 28 мин назад · 3 подтверждения/);
  assert.match(stationQueueText(station), /Ожидание сейчас может отличаться/);
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
  assert.match(stationFreshText(station), /^⚠ Последняя операция по данным Sber AZS: /);
  assert.match(stationFreshText(station), /данные устарели/);
});

test("attributes recent operations without claiming fuel was dispensed", () => {
  const observedAt = new Date(Date.now() - 15 * 60_000).toISOString();
  const text = stationFreshText({
    availabilityBySource: { alfa: { observedAt } },
    priceUpdatedAt: null,
  });

  assert.match(text, /^Последняя операция по данным Alfa AZS: /);
  assert.match(text, /МСК · 15 мин назад/);
  assert.doesNotMatch(text, /подтверждено/);
});

test("does not present an old, undated or future queue estimate as current", () => {
  const station = (observedAt) => ({ availabilityBySource: { yandex: { queueLabel: "Очередь 15–30 мин", observedAt } } });
  const stale = stationQueueText(station(new Date(Date.now() - 61 * 60_000).toISOString()));
  assert.match(stale, /данные устарели.*Яндекс Карты · 1 ч 1 мин назад/);
  assert.doesNotMatch(stale, /15–30/);
  for (const time of [null, "invalid", new Date(Date.now() + 10 * 60_000).toISOString()]) {
    assert.match(stationQueueText(station(time)), /время сообщения неизвестно/);
    assert.doesNotMatch(stationQueueText(station(time)), /15–30/);
  }
});

test("chooses the latest valid queue report and bank operation independently", () => {
  const now = Date.now();
  const station = { availabilityBySource: {
    tbank: { observedAt: new Date(now - 27 * 60_000).toISOString() },
    alfa: { observedAt: new Date(now - 97 * 60_000).toISOString() },
    yandex: { queueLabel: "Очередь 15–30 мин", observedAt: new Date(now - 28 * 60_000).toISOString() },
    gdebenz: { queueLabel: "Большая очередь", observedAt: new Date(now - 2 * 60_000).toISOString() },
  } };
  assert.match(stationFreshText(station), /Последняя операция по данным T‑Bank Fuel/);
  assert.match(stationQueueText(station), /Большая очередь · ГдеБЕНЗ · 2 мин назад/);
});
