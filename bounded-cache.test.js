import test from "node:test";
import assert from "node:assert/strict";
import { readFreshCache, writeBoundedCache } from "./domain/bounded-cache.js";

test("bounded cache evicts the least recently used entry", () => {
  const cache = new Map();
  writeBoundedCache(cache, "first", 1, 2, 10);
  writeBoundedCache(cache, "second", 2, 2, 20);
  assert.equal(readFreshCache(cache, "first", 100, 30), 1);
  writeBoundedCache(cache, "third", 3, 2, 40);
  assert.deepEqual([...cache.keys()], ["first", "third"]);
});

test("bounded cache removes expired entries", () => {
  const cache = new Map();
  writeBoundedCache(cache, "old", 1, 2, 10);
  assert.equal(readFreshCache(cache, "old", 20, 30), null);
  assert.equal(cache.size, 0);
});
