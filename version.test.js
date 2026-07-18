import test from "node:test";
import assert from "node:assert/strict";
import { nextPatchVersion } from "./scripts/bump-version.js";
import { readFile } from "node:fs/promises";

test("increments the software patch version for every commit", () => {
  assert.equal(nextPatchVersion("0.1.0"), "0.1.1");
  assert.equal(nextPatchVersion("2.7.99"), "2.7.100");
  assert.throws(() => nextPatchVersion("dev"), /SemVer/);
});

test("keeps package and lockfile application versions synchronized", async () => {
  const packageJson = JSON.parse(await readFile(new URL("./package.json", import.meta.url), "utf8"));
  const lock = JSON.parse(await readFile(new URL("./package-lock.json", import.meta.url), "utf8"));
  assert.equal(lock.version, packageJson.version);
  assert.equal(lock.packages[""].version, packageJson.version);
});
