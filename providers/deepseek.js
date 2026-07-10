import { config } from "../config.js";

export function buildDeepSeekRequest(request = {}, model = config.deepseek.model) {
  const messages = Array.isArray(request.messages) && request.messages.length > 0
    ? request.messages
    : [{ role: "user", content: String(request.prompt ?? "") }];
  const temperature = finiteNumber(request.temperature);
  const maxTokens = positiveInteger(request.maxTokens);
  const body = {
    model: request.model || model,
    messages,
    temperature,
    max_tokens: maxTokens,
  };

  if (request.json === true) body.response_format = { type: "json_object" };
  return Object.fromEntries(Object.entries(body).filter(([, value]) => value !== undefined));
}

export function createDeepSeekProvider(options = {}) {
  const baseUrl = String(options.baseUrl ?? config.deepseek.baseUrl).replace(/\/+$/, "");
  const apiKey = options.apiKey ?? config.deepseek.apiKey;
  const model = options.model || config.deepseek.model;
  const timeoutMs = positiveInteger(options.timeoutMs) || config.deepseek.timeoutMs;
  const fetchImpl = options.fetchImpl || globalThis.fetch;

  return {
    name: "deepseek",
    model,
    isConfigured: () => Boolean(baseUrl && apiKey && typeof fetchImpl === "function"),
    async generate(request = {}) {
      if (!baseUrl) throw new Error("DeepSeek base URL is not configured.");
      if (!apiKey) throw new Error("DeepSeek API key is not configured.");
      if (typeof fetchImpl !== "function") throw new Error("fetch is not available in this runtime.");

      const body = buildDeepSeekRequest(request, model);
      const response = await fetchImpl(`${baseUrl}/chat/completions`, {
        method: "POST",
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const detail = (await response.text()).slice(0, 300);
        throw new Error(`DeepSeek request failed: HTTP ${response.status}${detail ? ` ${detail}` : ""}`);
      }

      const raw = await response.json();
      const output = raw?.choices?.[0]?.message?.content;
      if (typeof output !== "string" || !output.trim()) throw new Error("DeepSeek returned an empty response.");

      return { provider: "deepseek", model: body.model, output, raw };
    },
  };
}

function finiteNumber(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function positiveInteger(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(1, Math.round(number)) : undefined;
}
