import assert from "node:assert/strict";
import test from "node:test";

import { inGeoBoundary } from "./domain/stations.js";

const polygon = {
  type: "Polygon",
  coordinates: [[
    [30, 50], [31, 50], [31, 51], [30, 51], [30, 50],
  ]],
};

test("keeps stations inside an administrative polygon and excludes bbox neighbours", () => {
  assert.equal(inGeoBoundary({ lat: 50.5, lon: 30.5 }, polygon), true);
  assert.equal(inGeoBoundary({ lat: 50.5, lon: 31.5 }, polygon), false);
  assert.equal(inGeoBoundary({ lat: 50, lon: 30.5 }, polygon), true);
});

test("supports multipolygons, holes, and a missing-boundary fallback", () => {
  const boundary = {
    type: "MultiPolygon",
    coordinates: [polygon.coordinates, [[
      [40, 60], [42, 60], [42, 62], [40, 62], [40, 60],
    ], [
      [40.5, 60.5], [41.5, 60.5], [41.5, 61.5], [40.5, 61.5], [40.5, 60.5],
    ]]],
  };
  assert.equal(inGeoBoundary({ lat: 61.8, lon: 41 }, boundary), true);
  assert.equal(inGeoBoundary({ lat: 61, lon: 41 }, boundary), false);
  assert.equal(inGeoBoundary({ lat: 90, lon: 90 }, null), true);
});
