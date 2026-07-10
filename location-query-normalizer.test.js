import assert from "node:assert/strict";
import test from "node:test";

import { normalizeLocationQueryWithLlm } from "./services/location-query-normalizer.js";

test("normalizes an arbitrary location query through the configured LLM", async () => {
  let request;
  const provider = {
    isConfigured: () => true,
    generate: async (value) => {
      request = value;
      return { output: '{"query":"Бабяково, Воронежская область","placeName":"Бабяково"}' };
    },
  };
  assert.deepEqual(await normalizeLocationQueryWithLlm("воронеж бабякова", provider), {
    query: "Бабяково, Воронежская область",
    placeName: "Бабяково",
  });
  assert.equal(request.temperature, 0);
  assert.equal(request.json, true);
});

test("skips LLM normalization when DeepSeek is not configured", async () => {
  assert.equal(await normalizeLocationQueryWithLlm("любой запрос", { isConfigured: () => false }), null);
});

test("ignores malformed LLM output", async () => {
  const provider = { isConfigured: () => true, generate: async () => ({ output: "не JSON" }) };
  assert.equal(await normalizeLocationQueryWithLlm("место", provider), null);
});
