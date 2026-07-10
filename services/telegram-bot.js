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
  const stations = [...(result.stations || [])]
    .sort((left, right) => statusRank(left.overallStatus) - statusRank(right.overallStatus))
    .slice(0, 8);
  const stationRows = stations.map((station, index) => formatStation(station, index + 1));
  const remaining = Math.max(0, (result.stations?.length || 0) - stations.length);

  return [
    `📍 ${result.location?.name || result.location?.displayName || "Найденная территория"}`,
    `АЗС найдено: ${summary.total || 0}`,
    `Вероятно есть топливо: ${statuses.available || 0}`,
    `Возможно есть: ${statuses.maybe_available || 0}`,
    `С ценами: ${summary.withPrices || 0}`,
    fuels.length ? `\nПо видам топлива:\n${fuels.join("\n")}` : "",
    stationRows.length ? `\nАЗС:\n\n${stationRows.join("\n\n")}` : "",
    remaining ? `\nЕщё ${remaining} АЗС доступны в веб-версии.` : "",
    warnings.length ? `\nОграничения источников:\n${warnings.join("\n")}` : "",
    "\nДоступность носит вероятностный характер. Полная таблица доступна в веб-версии.",
  ].filter(Boolean).join("\n");
}

const statusText = {
  available: "✅ вероятно есть",
  maybe_available: "🟡 возможно есть",
  not_available: "🔴 вероятно нет",
  no_data: "⚪ нет данных",
};

const sourceText = {
  tbank: "T‑Bank",
  sber: "Sber",
  benzup: "BenzUp",
  yandex: "Яндекс",
  gdebenz: "ГдеБЕНЗ",
  multigo: "Multigo",
};

function statusRank(status) {
  return ["available", "maybe_available", "no_data", "not_available"].indexOf(status) + 1 || 99;
}

function formatStation(station, number) {
  const fuels = Object.entries(station.fuelStatus || {}).map(([fuel, status]) => {
    const price = Number(station.prices?.[fuel]?.value);
    const priceText = Number.isFinite(price) ? ` · ${price.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽` : "";
    return `${fuel}: ${statusText[status] || status}${priceText}`;
  });
  const sources = [...new Set((station.sourceRefs || []).map((item) => sourceText[item.source] || item.source))];
  const address = String(station.address || "Адрес не указан").replace(/^Россия,\s*/i, "");
  const observedAt = formatObservedAt(station.lastTransactionAt);
  return [
    `${number}. ${statusText[station.overallStatus] || "⚪ нет данных"} — ${station.name || "АЗС"}`,
    `📍 ${address}`,
    fuels.length ? `⛽ ${fuels.join("; ")}` : "⛽ Данные по видам топлива отсутствуют",
    observedAt ? `🕒 Данные: ${observedAt}` : "",
    sources.length ? `Источники: ${sources.join(", ")}` : "",
  ].filter(Boolean).join("\n");
}

function formatObservedAt(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date) + " МСК";
}
