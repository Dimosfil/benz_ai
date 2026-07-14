import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeAlfaStation,
  requestAlfaRows,
  resetAlfaSession,
  selectAlfaStations,
} from "./providers/alfa.js";

function rawStation(overrides = {}) {
  return {
    station_id: "alfa-1",
    brand: { name: "Тестовая АЗС" },
    address: {
      fullname: "Воронеж",
      location: { latitude: 51.67, longitude: 39.24 },
    },
    fuels: [
      { category: "AI92", status: "available", price: "64.50", last_transaction_at: "2026-07-14T07:04:45.000Z" },
      { category: "AI98_100", status: "unknown", price: null, last_transaction_at: null },
      { category: "DIESEL", status: "closed", price: "80.06", last_transaction_at: "2026-07-14T07:34:46.000Z" },
    ],
    partner_stations: [],
    ...overrides,
  };
}

test("normalizes Alfa availability, combined premium fuel and prices", () => {
  const station = normalizeAlfaStation(rawStation());
  assert.equal(station.source, "alfa");
  assert.equal(station.externalId, "alfa-1");
  assert.equal(station.fuelStatus["92"], "available");
  assert.equal(station.fuelStatus["98/100"], "no_data");
  assert.equal(station.fuelStatus.DT, "not_available");
  assert.equal(station.overallStatus, "available");
  assert.equal(station.prices["92"].value, 64.5);
  assert.equal(station.prices.DT.source, "alfa");
  assert.equal(station.priceUpdatedAt, null);
  assert.equal(station.lastTransactionAt, "2026-07-14T07:34:46.000Z");
});

test("filters the nationwide Alfa snapshot by the requested bbox", () => {
  const outside = rawStation({
    station_id: "alfa-2",
    address: { fullname: "Москва", location: { latitude: 55.75, longitude: 37.61 } },
  });
  const result = selectAlfaStations([rawStation(), outside], {
    minLat: 51.5, maxLat: 51.8, minLon: 39.0, maxLon: 39.5,
  });
  assert.equal(result.returned, 2);
  assert.equal(result.stations.length, 1);
  assert.equal(result.stations[0].externalId, "alfa-1");
  assert.equal(result.droppedOutside, 1);
});

test("completes the Alfa HTTP challenge with response cookies", async () => {
  resetAlfaSession();
  const calls = [];
  const fetchImpl = async (_url, options) => {
    calls.push(options);
    if (calls.length === 1) {
      const headers = new Headers();
      headers.append("set-cookie", "spid=first; Path=/; Secure");
      headers.append("set-cookie", "spsc=second; Path=/; Secure");
      return new Response(null, { status: 307, headers });
    }
    return Response.json([rawStation()]);
  };

  const rows = await requestAlfaRows("https://alfabank.ru/api/v1/azs-stations/public/stations", fetchImpl);
  assert.equal(rows.length, 1);
  assert.equal(calls.length, 2);
  assert.match(calls[1].headers.Cookie, /spid=first/);
  assert.match(calls[1].headers.Cookie, /spsc=second/);
  assert.equal(calls[1].redirect, "manual");
});

test("rejects an unknown Alfa station contract", async () => {
  resetAlfaSession();
  await assert.rejects(
    requestAlfaRows("https://alfabank.ru/api/v1/azs-stations/public/stations", async () => Response.json([{}])),
    /неизвестный формат ответа/,
  );
});
