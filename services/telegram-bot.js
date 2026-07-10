export function createBenzTelegramHandler({ findSummary }) {
  return async function handleTelegramMessage(message) {
    const text = String(message?.text || "").trim();
    if (!text) return null;

    if (/^\/(start|help)(?:@\w+)?$/i.test(text)) {
      return [
        "Benz AI ищет АЗС и вероятностные данные о наличии топлива.",
        "Отправьте название города или региона России, например: Воронеж.",
        "Веб-версия показывает полный список станций, фильтры и источники.",
      ].join("\n\n");
    }

    if (text.startsWith("/")) {
      return "Неизвестная команда. Отправьте /help или название города/региона.";
    }

    try {
      const result = await findSummary(text);
      return formatTelegramSummary(result);
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      return `Не удалось выполнить поиск: ${messageText}`;
    }
  };
}

export function formatTelegramSummary(result) {
  const summary = result.summary || {};
  const statuses = summary.statuses || {};
  const fuels = Object.entries(summary.fuels || {})
    .sort(([left], [right]) => left.localeCompare(right, "ru", { numeric: true }))
    .map(([fuel, values]) => `${fuel}: ${values.available || 0} вероятно есть`)
    .slice(0, 8);
  const warnings = (result.warnings || []).filter(Boolean).slice(0, 3);

  return [
    `📍 ${result.location?.name || result.location?.displayName || "Найденная территория"}`,
    `АЗС найдено: ${summary.total || 0}`,
    `Вероятно есть топливо: ${statuses.available || 0}`,
    `Возможно есть: ${statuses.maybe_available || 0}`,
    `С ценами: ${summary.withPrices || 0}`,
    fuels.length ? `\nПо видам топлива:\n${fuels.join("\n")}` : "",
    warnings.length ? `\nОграничения источников:\n${warnings.join("\n")}` : "",
    "\nДоступность носит вероятностный характер. Полная таблица доступна в веб-версии.",
  ].filter(Boolean).join("\n");
}
