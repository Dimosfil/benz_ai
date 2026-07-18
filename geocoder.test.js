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
    assert.equal((await geocodeLocation("Воронеж бабякова")).name, "Бабяково");
  } finally {
    globalThis.fetch = previousFetch;
    clearGeocoderCache();
  }
});
