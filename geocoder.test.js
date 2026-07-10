import assert from "node:assert/strict";
import test from "node:test";

import { geocoderQueryCandidates } from "./services/geocoder.js";

test("adds a likely settlement spelling for a Russian name in genitive form", () => {
  assert.deepEqual(geocoderQueryCandidates("Воронеж бабякова"), ["Воронеж бабякова", "Воронеж бабяково"]);
  assert.deepEqual(geocoderQueryCandidates("Бабякова"), ["Бабякова", "Бабяково"]);
});

test("does not rewrite ordinary city and region queries", () => {
  assert.deepEqual(geocoderQueryCandidates("Самара"), ["Самара"]);
  assert.deepEqual(geocoderQueryCandidates("Воронежская область"), ["Воронежская область"]);
});
