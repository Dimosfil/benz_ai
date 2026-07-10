import test from "node:test";
import assert from "node:assert/strict";
import { buildDeepSeekRequest, createDeepSeekProvider } from "./providers/deepseek.js";

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
