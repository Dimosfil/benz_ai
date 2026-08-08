import { createDeepSeekProvider } from "../providers/deepseek.js";
import { config } from "../config.js";

const defaultProvider = createDeepSeekProvider({ timeoutMs: config.deepseek.normalizerTimeoutMs });

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
        { role: "system", content: "Нормализуй пользовательский запрос для геокодера населённых пунктов и административных территорий России: областей, краёв, республик, округов, городских и муниципальных районов. Исправь опечатки, падеж и разговорную форму, сохрани весь указанный географический контекст. Если запрос имеет вид «<город> <район>», сформируй однозначный запрос «<название> район, <город>, <регион>, Россия». Не выдумывай место. Ответь только JSON: {\"query\":\"однозначная строка для геокодера\",\"placeName\":\"точное название искомого объекта\"}." },
        { role: "user", content: original },
      ],
      temperature: 0,
      maxTokens: config.deepseek.normalizerMaxTokens,
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
