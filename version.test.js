import test from "node:test";
import assert from "node:assert/strict";
import { nextPatchVersion } from "./scripts/bump-version.js";

test("increments the software patch version for every commit", () => {
  assert.equal(nextPatchVersion("0.1.0"), "0.1.1");
  assert.equal(nextPatchVersion("2.7.99"), "2.7.100");
  assert.throws(() => nextPatchVersion("dev"), /SemVer/);
});
