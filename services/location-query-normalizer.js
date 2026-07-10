import { createDeepSeekProvider } from "../providers/deepseek.js";

const defaultProvider = createDeepSeekProvider();

function parseJsonObject(value) {
  const text = String(value || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try { return JSON.parse(text); }
  catch { return null; }
}

export async function normalizeLocationQueryWithLlm(rawQuery, provider = defaultProvider) {
  const original = String(rawQuery || "").trim();
  if (!original || !provider?.isConfigured?.()) return null;
  try {
    const response = await provider.generate({
      messages: [
        { role: "system", content: "Нормализуй пользовательский запрос для геокодера населённых пунктов России. Исправь опечатки, падеж и разговорную форму, сохрани указанный регион. Не выдумывай место. Ответь только JSON: {\"query\":\"строка для геокодера\",\"placeName\":\"точное название населённого пункта\"}." },
        { role: "user", content: original },
      ],
      temperature: 0,
      maxTokens: 120,
      json: true,
    });
    const parsed = parseJsonObject(response.output);
    const query = String(parsed?.query || "").trim();
    const placeName = String(parsed?.placeName || "").trim();
    if (!query || !placeName || query.length > 100 || placeName.length > 80) return null;
    return { query, placeName };
  } catch {
    return null;
  }
}
