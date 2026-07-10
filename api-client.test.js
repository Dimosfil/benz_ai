import test from "node:test";
import assert from "node:assert/strict";
import { fetchJson } from "./public/api-client.js";
import { providerFailureMessage } from "./server.js";

test("labels a provider network failure instead of leaking Failed to fetch", () => {
  const warning = providerFailureMessage({ status: "rejected", reason: new TypeError("Failed to fetch") }, "Multigo");
  assert.equal(warning, "Multigo: не удалось подключиться к источнику.");
});

test("preserves a labeled provider contract error", () => {
  const warning = providerFailureMessage({ status: "rejected", reason: new Error("вернул HTTP 503") }, "T-Bank");
  assert.equal(warning, "T-Bank: вернул HTTP 503");
});

test("translates a browser-level API connection failure", async () => {
  await assert.rejects(
    fetchJson("/api/summary", {}, async () => { throw new TypeError("Failed to fetch"); }),
    /Не удалось связаться с сервером/,
  );
});

test("uses the server JSON error for an unsuccessful response", async () => {
  await assert.rejects(
    fetchJson("/api/summary", {}, async () => ({
      ok: false,
      status: 400,
      async json() { return { error: "Город не найден" }; },
    })),
    /Город не найден/,
  );
});
