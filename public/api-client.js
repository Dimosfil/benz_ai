export async function fetchJson(url, options = {}, fetchImpl = globalThis.fetch) {
  let response;
  try {
    response = await fetchImpl(url, options);
  } catch {
    throw new Error("Не удалось связаться с сервером. Проверьте подключение и повторите запрос.");
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(response.ok
      ? "Сервер вернул некорректный ответ."
      : `Сервер временно недоступен (HTTP ${response.status}).`);
  }

  if (!response.ok) throw new Error(data?.error || `Не удалось получить сводку (HTTP ${response.status}).`);
  return data;
}

export async function fetchNdjson(url, options = {}, onItem = () => {}, fetchImpl = globalThis.fetch) {
  let response;
  try {
    response = await fetchImpl(url, options);
  } catch {
    throw new Error("Не удалось связаться с сервером. Проверьте подключение и повторите запрос.");
  }

  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.error || `Не удалось загрузить АЗС (HTTP ${response.status}).`);
  }
  if (!response.body) throw new Error("Сервер не начал потоковую загрузку АЗС.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const consumeLines = (flush = false) => {
    const lines = buffer.split("\n");
    buffer = flush ? "" : lines.pop();
    for (const line of lines) {
      const value = line.trim();
      if (value) onItem(JSON.parse(value));
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    consumeLines(done);
    if (done) break;
  }
}
