import assert from "node:assert/strict";
import test from "node:test";

import { clearGeocoderCache, geocodeLocation, geocoderQueryCandidates } from "./services/geocoder.js";

test("adds a likely settlement spelling for a Russian name in genitive form", () => {
  assert.deepEqual(geocoderQueryCandidates("Воронеж бабякова"), ["Воронеж бабякова", "Воронеж бабяково"]);
  assert.deepEqual(geocoderQueryCandidates("Бабякова"), ["Бабякова", "Бабяково"]);
});

test("does not rewrite ordinary city and region queries", () => {
  assert.deepEqual(geocoderQueryCandidates("Самара"), ["Самара"]);
  assert.deepEqual(geocoderQueryCandidates("Воронежская область"), ["Воронежская область"]);
});

test("corrects a settlement spelling even when a region follows it", () => {
  assert.deepEqual(
    geocoderQueryCandidates("Бабякова, Воронежская область"),
    ["Бабякова, Воронежская область", "Бабяково, Воронежская область"],
  );
});

test("accepts the corrected settlement after a city prefix", async () => {
  const previousFetch = globalThis.fetch;
  clearGeocoderCache();
  globalThis.fetch = async (url) => {
    const query = new URL(url).searchParams.get("q");
    return Response.json(query.endsWith("бабяково") ? [{
      name: "Бабяково",
      display_name: "село Бабяково, Новоусманский район, Воронежская область, Россия",
      lat: "51.713",
      lon: "39.364",
      boundingbox: ["51.70", "51.72", "39.35", "39.38"],
      geojson: null,
    }] : []);
  };
  try {
    assert.equal((await geocodeLocation("Воронеж бабякова", { normalizeQuery: async () => null })).name, "Бабяково");
  } finally {
    globalThis.fetch = previousFetch;
    clearGeocoderCache();
  }
});

test("calls LLM before accepting a contextual administrative result", async () => {
  const previousFetch = globalThis.fetch;
  clearGeocoderCache();
  globalThis.fetch = async () => Response.json([{
    name: "Советский",
    display_name: "Советский, Бобровский район, Воронежская область, Россия",
    type: "hamlet",
    addresstype: "hamlet",
    lat: "50.8849",
    lon: "40.2103",
    boundingbox: ["50.8649", "50.9049", "40.1903", "40.2303"],
  }, {
    name: "Советский район",
    display_name: "Советский район, Воронеж, городской округ Воронеж, Воронежская область, Россия",
    type: "administrative",
    addresstype: "city_district",
    lat: "51.6278",
    lon: "39.1141",
    boundingbox: ["51.5402", "51.7149", "39.0132", "39.2031"],
  }]);
  let normalizerCalled = false;
  try {
    const location = await geocodeLocation("Воронеж Советский", {
      normalizeQuery: async () => { normalizerCalled = true; return null; },
    });
    assert.equal(location.name, "Советский район");
    assert.equal(normalizerCalled, true);
  } finally {
    globalThis.fetch = previousFetch;
    clearGeocoderCache();
  }
});

test("uses LLM normalization after an ambiguous raw geocoder result", async () => {
  const previousFetch = globalThis.fetch;
  clearGeocoderCache();
  const requestedQueries = [];
  globalThis.fetch = async (url) => {
    const query = new URL(url).searchParams.get("q");
    requestedQueries.push(query);
    return Response.json(query.startsWith("Советский район") ? [{
      name: "Советский район",
      display_name: "Советский район, Воронеж, городской округ Воронеж, Воронежская область, Россия",
      type: "administrative",
      addresstype: "city_district",
      lat: "51.6278",
      lon: "39.1141",
      boundingbox: ["51.5402", "51.7149", "39.0132", "39.2031"],
      geojson: null,
    }] : [{
      name: "Советская",
      display_name: "Советская, Бобровский район, Воронежская область, Россия",
      type: "hamlet",
      addresstype: "hamlet",
      lat: "50.8849",
      lon: "40.2103",
      boundingbox: ["50.8649", "50.9049", "40.1903", "40.2303"],
      geojson: null,
    }]);
  };
  try {
    const location = await geocodeLocation("Воронеж Советский", {
      normalizeQuery: async () => ({
        query: "Советский район, Воронеж, Воронежская область, Россия",
        placeName: "Советский район",
      }),
    });
    assert.equal(location.name, "Советский район");
    assert.deepEqual(requestedQueries, ["Советский район, Воронеж, Воронежская область, Россия"]);
  } finally {
    globalThis.fetch = previousFetch;
    clearGeocoderCache();
  }
});

test("does not trust an LLM place name that Nominatim cannot verify", async () => {
  const previousFetch = globalThis.fetch;
  clearGeocoderCache();
  globalThis.fetch = async (url) => {
    const query = new URL(url).searchParams.get("q");
    return Response.json(query === "Несуществующий район, Воронеж, Россия" ? [{
      name: "Другой район",
      display_name: "Другой район, Воронеж, Россия",
      lat: "51.60",
      lon: "39.10",
      boundingbox: ["51.50", "51.70", "39.00", "39.20"],
    }] : [{
      name: "Воронеж",
      display_name: "Воронеж, городской округ Воронеж, Воронежская область, Россия",
      lat: "51.66",
      lon: "39.20",
      boundingbox: ["51.50", "51.85", "39.00", "39.40"],
    }]);
  };
  try {
    const location = await geocodeLocation("Воронеш", {
      normalizeQuery: async () => ({
        query: "Несуществующий район, Воронеж, Россия",
        placeName: "Несуществующий район",
      }),
    });
    assert.equal(location.name, "Воронеж");
  } finally {
    globalThis.fetch = previousFetch;
    clearGeocoderCache();
  }
});
