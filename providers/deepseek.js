import { config } from "../config.js";

export function buildDeepSeekRequest(request = {}, model = config.deepseek.model, jsonMode = "json_object") {
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

  if (request.json === true) {
    body.response_format = jsonMode === "json_schema"
      ? {
          type: "json_schema",
          json_schema: {
            name: request.jsonSchemaName || "structured_response",
            strict: true,
            schema: request.jsonSchema || { type: "object", additionalProperties: true },
          },
        }
      : { type: "json_object" };
  }
  return Object.fromEntries(Object.entries(body).filter(([, value]) => value !== undefined));
}

export function buildLmStudioRequest(request = {}, model = config.deepseek.model) {
  const messages = Array.isArray(request.messages) && request.messages.length > 0
    ? request.messages
    : [{ role: "user", content: String(request.prompt ?? "") }];
  const systemPrompt = messages
    .filter((message) => message?.role === "system")
    .map((message) => String(message.content || ""))
    .filter(Boolean)
    .join("\n\n");
  const input = messages
    .filter((message) => message?.role !== "system")
    .map((message) => String(message?.content || ""))
    .filter(Boolean)
    .join("\n\n");
  const body = {
    model: request.model || model,
    input,
    system_prompt: systemPrompt || undefined,
    temperature: finiteNumber(request.temperature),
    max_output_tokens: positiveInteger(request.maxTokens),
    reasoning: "off",
    store: false,
  };
  return Object.fromEntries(Object.entries(body).filter(([, value]) => value !== undefined));
}

export function createDeepSeekProvider(options = {}) {
  const baseUrl = String(options.baseUrl ?? config.deepseek.baseUrl).replace(/\/+$/, "");
  const apiKey = options.apiKey ?? config.deepseek.apiKey;
  const model = options.model || config.deepseek.model;
  const apiMode = options.apiMode || config.deepseek.apiMode;
  const jsonMode = options.jsonMode || config.deepseek.jsonMode;
  const timeoutMs = positiveInteger(options.timeoutMs) || config.deepseek.timeoutMs;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const allowUnauthenticated = options.allowUnauthenticated ?? config.deepseek.allowUnauthenticated;
  const explicitlyEnabled = options.enabled ?? config.deepseek.enabled;
  const providerName = apiMode === "lmstudio" ? "lmstudio" : "openai-compatible";
  const metrics = {
    requests: 0,
    successes: 0,
    failures: 0,
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastError: null,
    lastDurationMs: null,
  };

  const isConfigured = () => Boolean(
    explicitlyEnabled
    && baseUrl
    && model
    && typeof fetchImpl === "function"
    && (apiKey || allowUnauthenticated)
  );

  return {
    name: providerName,
    model,
    isConfigured,
    status: () => ({
      configured: isConfigured(),
      provider: providerName,
      baseUrl,
      model,
      apiMode,
      jsonMode,
      authenticated: Boolean(apiKey),
      ...metrics,
    }),
    async generate(request = {}) {
      if (!baseUrl) throw new Error("DeepSeek base URL is not configured.");
      if (!apiKey && !allowUnauthenticated) throw new Error("LLM API key is not configured and unauthenticated access is disabled.");
      if (typeof fetchImpl !== "function") throw new Error("fetch is not available in this runtime.");

      const nativeLmStudio = apiMode === "lmstudio";
      const body = nativeLmStudio
        ? buildLmStudioRequest(request, model)
        : buildDeepSeekRequest(request, model, jsonMode);
      const startedAt = Date.now();
      metrics.requests += 1;
      metrics.lastAttemptAt = new Date(startedAt).toISOString();
      try {
        const headers = {
          Accept: "application/json",
          "Content-Type": "application/json",
        };
        if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
        const response = await fetchImpl(`${baseUrl}${nativeLmStudio ? "/api/v1/chat" : "/chat/completions"}`, {
          method: "POST",
          signal: AbortSignal.timeout(timeoutMs),
          headers,
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          const detail = (await response.text()).slice(0, 300);
          throw new Error(`LLM request failed: HTTP ${response.status}${detail ? ` ${detail}` : ""}`);
        }

        const raw = await response.json();
        const output = nativeLmStudio
          ? raw?.output?.find((item) => item?.type === "message")?.content
          : raw?.choices?.[0]?.message?.content;
        if (typeof output !== "string" || !output.trim()) throw new Error("LLM returned an empty response.");

        metrics.successes += 1;
        metrics.lastSuccessAt = new Date().toISOString();
        metrics.lastError = null;
        return { provider: providerName, model: body.model, output, raw };
      } catch (error) {
        metrics.failures += 1;
        metrics.lastError = String(error?.message || error).slice(0, 300);
        throw error;
      } finally {
        metrics.lastDurationMs = Date.now() - startedAt;
      }
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
