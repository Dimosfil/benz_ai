import test from "node:test";
import assert from "node:assert/strict";
import { resolveBuildInfo } from "./build-info.js";

test("uses injected commit metadata for packaged runtimes", () => {
  const info = resolveBuildInfo({
    GIT_COMMIT_SHA: "1234567890abcdef",
    GIT_COMMIT_DATE: "2026-07-11T10:30:00+03:00",
  }, () => { throw new Error("git fallback must not run"); });
  assert.deepEqual(info, {
    commit: "1234567890abcdef",
    shortCommit: "12345678",
    committedAt: "2026-07-11T10:30:00+03:00",
  });
});

test("falls back to the current Git checkout", () => {
  const values = ["abcdef1234567890", "2026-07-11T09:00:00+03:00"];
  const info = resolveBuildInfo({}, () => values.shift());
  assert.equal(info.shortCommit, "abcdef12");
  assert.equal(info.committedAt, "2026-07-11T09:00:00+03:00");
});
