import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { X509Certificate } from "node:crypto";
import { usesBankCa, bankFetch } from "./providers/bank-http.js";
import { SberBrowserWorker } from "./providers/sber-browser.js";
import { providerFailureMessage } from "./server.js";

const bbox = { minLat: 51.67, maxLat: 51.70, minLon: 39.32, maxLon: 39.39 };
const data = { apiVersion: 1, stations: [{ id: "one", lastPaymentAt: "2026-09-25T14:59:10+03:00" }] };

test("bank CA is the verified public root and applies only to the exact HTTPS feeds", () => {
  const cert = new X509Certificate(readFileSync(new URL("./providers/certs/russian-trusted-root-ca.pem", import.meta.url)));
  assert.equal(cert.ca, true);
  assert.equal(cert.fingerprint256.replaceAll(":", ""), "D26D2D0231B7C39F92CC738512BA54103519E4405D68B5BD703E9788CA8ECF31");
  for (const url of ["https://alfabank.ru/api/test", "https://toplivo.tbank.ru:443/api/test"]) assert.equal(usesBankCa(url), true);
  for (const url of ["http://alfabank.ru/", "https://alfabank.ru:8443/", "https://alfabank.ru.evil.test/", "https://evil.test/", "https://sberazs.ru/"]) assert.equal(usesBankCa(url), false);
});

test("custom API hosts retain their normal transport and do not acquire bank CA trust", async () => {
  const original = globalThis.fetch;
  const signal = new AbortController().signal;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://custom.example/api");
    assert.equal(options.signal, signal);
    assert.equal(options.ca, undefined);
    return Response.json({ ok: true });
  };
  try { assert.deepEqual(await (await bankFetch("https://custom.example/api", { signal })).json(), { ok: true }); }
  finally { globalThis.fetch = original; }
});

test("Sber reads JSON without cookies or browser, coalesces requests and caches payments", async () => {
  const original = globalThis.fetch;
  const worker = new SberBrowserWorker();
  let calls = 0;
  worker.ensureStarted = async () => { throw new Error("Browser must not start"); };
  globalThis.fetch = async (url) => {
    calls++;
    assert.equal(url, "https://sberazs.ru/api/stations?bbox=39.32,51.67,39.39,51.7");
    return Response.json(data);
  };
  try {
    const [first, second] = await Promise.all([worker.getStations(bbox), worker.getStations(bbox)]);
    assert.deepEqual(first, second);
    assert.equal(first.stations[0].lastPaymentAt, data.stations[0].lastPaymentAt);
    assert.equal(first.browser, false);
    await worker.getStations(bbox);
    assert.equal(calls, 1);
    worker.invalidateAll();
    await worker.getStations(bbox);
    assert.equal(calls, 2);
  } finally { globalThis.fetch = original; await worker.close(); }
});

test("Sber falls back to the browser only for an actual HTML challenge", async () => {
  const original = globalThis.fetch;
  const worker = new SberBrowserWorker();
  let starts = 0;
  worker.ensureStarted = async () => {
    starts++;
    worker.cdp = { evaluate: async () => data, close() {} };
  };
  globalThis.fetch = async () => new Response("<html><script>challenge()</script></html>", { status: 403 });
  try {
    const result = await worker.getStations(bbox);
    assert.equal(starts, 1);
    assert.equal(result.browser, true);
    assert.deepEqual(result.stations, data.stations);
  } finally { globalThis.fetch = original; await worker.close(); }
});

test("Sber reports invalid JSON, schema and HTTP failures and retries next time", async () => {
  const original = globalThis.fetch;
  const worker = new SberBrowserWorker();
  worker.ensureStarted = async () => { throw new Error("Unexpected browser fallback"); };
  try {
    for (const [response, message] of [[new Response("broken"), /не JSON/], [Response.json({}), /неизвестный формат/], [Response.json({}, { status: 503 }), /HTTP 503/]]) {
      globalThis.fetch = async () => response;
      await assert.rejects(worker.getStations(bbox), message);
      assert.equal(worker.status().lastRefreshAt, null);
    }
    globalThis.fetch = async () => Response.json(data);
    assert.deepEqual((await worker.getStations(bbox)).stations, data.stations);
    assert.equal(worker.status().lastError, null);
  } finally { globalThis.fetch = original; await worker.close(); }
});

test("provider diagnostics distinguish TLS and timeout failures from missing data", () => {
  assert.match(providerFailureMessage({ status: "rejected", reason: new TypeError("fetch failed", { cause: { code: "SELF_SIGNED_CERT_IN_CHAIN" } }) }, "Alfa"), /TLS-сертификата.*SELF_SIGNED_CERT_IN_CHAIN/);
  assert.match(providerFailureMessage({ status: "rejected", reason: { name: "TimeoutError", message: "expired" } }, "Sber"), /время ожидания/);
});
