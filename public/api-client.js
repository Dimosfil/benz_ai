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
