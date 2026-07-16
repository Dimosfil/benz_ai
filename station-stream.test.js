import test from "node:test";
import assert from "node:assert/strict";
import { streamProviderSnapshots } from "./server.js";

test("streams a merged station snapshot whenever a provider finishes", async () => {
  let releaseSlowProvider;
  const slowProvider = new Promise((resolve) => { releaseSlowProvider = resolve; });
  const snapshots = [];
  const streaming = streamProviderSnapshots([
    slowProvider,
    Promise.resolve({ stations: [{ name: "Fast", lat: 51, lon: 39, sources: ["fast"] }] }),
  ], (snapshot) => snapshots.push(snapshot));

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].stations[0].name, "Fast");
  assert.equal(snapshots[0].complete, false);

  releaseSlowProvider({ stations: [{ name: "Slow", lat: 52, lon: 40, sources: ["slow"] }] });
  await streaming;
  assert.equal(snapshots.length, 2);
  assert.equal(snapshots[1].stations.length, 2);
  assert.equal(snapshots[1].complete, true);
});
