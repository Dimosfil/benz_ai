import test from "node:test";
import assert from "node:assert/strict";
import { fetchJson, fetchNdjson } from "./public/api-client.js";
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

test("delivers NDJSON records as soon as response chunks arrive", async () => {
  const encoder = new TextEncoder();
  let releaseSecondChunk;
  const secondChunk = new Promise((resolve) => { releaseSecondChunk = resolve; });
  const response = new Response(new ReadableStream({
    async start(controller) {
      controller.enqueue(encoder.encode('{"stations":[{"name":"First"}]}\n'));
      await secondChunk;
      controller.enqueue(encoder.encode('{"stations":[{"name":"First"},{"name":"Second"}]}\n'));
      controller.close();
    },
  }));
  const received = [];
  const loading = fetchNdjson("/api/stations/stream", {}, (item) => received.push(item), async () => response);

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(received.length, 1);
  assert.equal(received[0].stations[0].name, "First");

  releaseSecondChunk();
  await loading;
  assert.equal(received.length, 2);
  assert.equal(received[1].stations[1].name, "Second");
});
