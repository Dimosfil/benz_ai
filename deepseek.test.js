import test from "node:test";
import assert from "node:assert/strict";
import { buildDeepSeekRequest, buildLmStudioRequest, createDeepSeekProvider } from "./providers/deepseek.js";

test("maps a prompt to the DeepSeek chat-completions contract", () => {
  assert.deepEqual(buildDeepSeekRequest({
    prompt: "Ответь JSON",
    temperature: 0.2,
    maxTokens: 50,
    json: true,
  }, "deepseek-chat"), {
    model: "deepseek-chat",
    messages: [{ role: "user", content: "Ответь JSON" }],
    temperature: 0.2,
    max_tokens: 50,
    response_format: { type: "json_object" },
  });
});

test("sends a server-side authenticated DeepSeek request", async () => {
  let captured;
  const provider = createDeepSeekProvider({
    baseUrl: "https://example.test/",
    apiKey: "test-key",
    model: "deepseek-chat",
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return {
        ok: true,
        async json() {
          return { choices: [{ message: { content: "готово" } }] };
        },
      };
    },
  });

  const result = await provider.generate({ messages: [{ role: "user", content: "тест" }] });
  assert.equal(captured.url, "https://example.test/chat/completions");
  assert.equal(captured.options.headers.Authorization, "Bearer test-key");
  assert.equal(JSON.parse(captured.options.body).model, "deepseek-chat");
  assert.equal(result.output, "готово");
});

test("does not report DeepSeek as configured without an API key", () => {
  const provider = createDeepSeekProvider({ apiKey: "", fetchImpl: async () => ({ ok: true }) });
  assert.equal(provider.isConfigured(), false);
});

test("supports an explicitly unauthenticated local OpenAI-compatible endpoint", async () => {
  let captured;
  const provider = createDeepSeekProvider({
    enabled: true,
    baseUrl: "http://127.0.0.1:1234/v1",
    apiMode: "openai-compatible",
    apiKey: "",
    allowUnauthenticated: true,
    model: "local-model",
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return Response.json({ choices: [{ message: { content: "ok" } }] });
    },
  });

  const result = await provider.generate({ prompt: "test" });

  assert.equal(provider.isConfigured(), true);
  assert.equal(captured.url, "http://127.0.0.1:1234/v1/chat/completions");
  assert.equal(captured.options.headers.Authorization, undefined);
  assert.equal(result.provider, "openai-compatible");
  assert.deepEqual(provider.status(), {
    configured: true,
    provider: "openai-compatible",
    baseUrl: "http://127.0.0.1:1234/v1",
    model: "local-model",
    apiMode: "openai-compatible",
    jsonMode: "json_object",
    authenticated: false,
    requests: 1,
    successes: 1,
    failures: 0,
    lastAttemptAt: provider.status().lastAttemptAt,
    lastSuccessAt: provider.status().lastSuccessAt,
    lastError: null,
    lastDurationMs: provider.status().lastDurationMs,
  });
});

test("uses LM Studio native chat with reasoning disabled", async () => {
  assert.deepEqual(buildLmStudioRequest({
    messages: [
      { role: "system", content: "Return JSON." },
      { role: "user", content: "Voronezh Babyakovo" },
    ],
    temperature: 0,
    maxTokens: 512,
  }, "qwen-local"), {
    model: "qwen-local",
    input: "Voronezh Babyakovo",
    system_prompt: "Return JSON.",
    temperature: 0,
    max_output_tokens: 512,
    reasoning: "off",
    store: false,
  });

  let captured;
  const provider = createDeepSeekProvider({
    enabled: true,
    apiMode: "lmstudio",
    baseUrl: "http://127.0.0.1:1234",
    apiKey: "",
    allowUnauthenticated: true,
    model: "qwen-local",
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return Response.json({
        output: [{ type: "message", content: "{\"query\":\"Бабяково\",\"placeName\":\"Бабяково\"}" }],
      });
    },
  });

  const result = await provider.generate({ prompt: "test", json: true });

  assert.equal(captured.url, "http://127.0.0.1:1234/api/v1/chat");
  assert.equal(JSON.parse(captured.options.body).reasoning, "off");
  assert.equal(result.provider, "lmstudio");
  assert.equal(result.output, "{\"query\":\"Бабяково\",\"placeName\":\"Бабяково\"}");
});
