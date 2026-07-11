import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveBuildInfo } from "./build-info.js";
import { metadataFromGitHeadLog } from "./scripts/create-build-metadata.js";

test("uses injected commit metadata for packaged runtimes", () => {
  const info = resolveBuildInfo({
    GIT_COMMIT_SHA: "1234567890abcdef",
    GIT_COMMIT_DATE: "2026-07-11T10:30:00+03:00",
  }, () => { throw new Error("git fallback must not run"); });
  assert.deepEqual(info, {
    version: JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version,
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

test("ignores the Docker placeholder commit", () => {
  const values = ["abcdef1234567890", "2026-07-11T09:00:00+03:00"];
  const info = resolveBuildInfo({ GIT_COMMIT_SHA: "unknown" }, () => values.shift());
  assert.equal(info.shortCommit, "abcdef12");
});

test("creates Docker metadata from the current Git HEAD log", () => {
  const metadata = metadataFromGitHeadLog(
    "0000000000000000000000000000000000000000 abcdef1234567890abcdef1234567890abcdef12 User <user@example.test> 1783756930 +0300\tcommit: Test",
  );
  assert.equal(metadata.commit, "abcdef1234567890abcdef1234567890abcdef12");
  assert.equal(metadata.shortCommit, "abcdef12");
  assert.equal(metadata.committedAt, "2026-07-11T08:02:10.000Z");
});
