export function createBenzTelegramHandler({ findSummary, refreshSummary = findSummary }) {
  return async function handleTelegramMessage(message) {
    const text = String(message?.text || "").trim();
    if (!text) return null;

    if (/^\/(start|help)(?:@\w+)?$/i.test(text)) {
      return [
        "Benz AI ищет АЗС и вероятностные данные о наличии топлива.",
        "Отправьте название города или региона России, например: Воронеж.",
        "Для принудительного обновления используйте: /refresh Воронеж.",
        "Веб-версия показывает полный список станций, фильтры и источники.",
      ].join("\n\n");
    }

    const refreshMatch = text.match(/^\/refresh(?:@\w+)?(?:\s+(.+))?$/i);
    if (refreshMatch) {
      const query = refreshMatch[1]?.trim();
      if (!query) return "Укажите город или регион после команды, например: /refresh Новая Усмань";
      try {
        return formatTelegramSummary(await refreshSummary(query));
      } catch (error) {
        const messageText = error instanceof Error ? error.message : String(error);
        return `Не удалось обновить данные: ${messageText}`;
      }
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
  const fuelKeys = new Set([...Object.keys(station.fuelStatus || {}), ...Object.keys(station.prices || {})]);
  const fuels = [...fuelKeys].map((fuel) => {
    const status = station.fuelStatus?.[fuel];
    return `${fuel}: ${statusText[status] || "⚪ нет данных"}`;
  });
  const priceLines = formatPrices(station);
  const sourceEvidence = formatSourceEvidence(station);
  const address = String(station.address || "Адрес не указан").replace(/^Россия,\s*/i, "");
  const observedAt = formatObservedAt(station.lastTransactionAt);
  const fuelStatuses = Object.values(station.fuelStatus || {});
  const stationOnlyStatus = station.overallStatus !== "no_data"
    && fuelStatuses.length > 0
    && fuelStatuses.every((status) => status === "no_data");
  return [
    `${number}. ${statusText[station.overallStatus] || "⚪ нет данных"} — ${station.name || "АЗС"}`,
    `📍 ${address}`,
    fuels.length ? `⛽ ${fuels.join("; ")}` : "⛽ Данные по видам топлива отсутствуют",
    ...priceLines,
    stationOnlyStatus ? "ℹ️ Общий статус относится ко всей АЗС; по отдельным видам топлива данных нет." : "",
    observedAt ? `🕒 Данные: ${observedAt}` : "",
    sourceEvidence ? `Сигналы: ${sourceEvidence}` : "",
  ].filter(Boolean).join("\n");
}

function formatPrices(station) {
  const prices = Object.entries(station.prices || {}).filter(([, price]) => Number.isFinite(Number(price?.value)));
  if (!prices.length) return [];
  const values = prices.map(([fuel, price]) => {
    const value = Number(price.value).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `${fuel} — ${value} ₽`;
  });
  const sources = [...new Set(prices.map(([, price]) => sourceText[price.source] || price.source).filter(Boolean))];
  const metadata = [sources.length ? `источник: ${sources.join(", ")}` : "", station.priceUpdatedAt ? `обновлено: ${station.priceUpdatedAt}` : ""]
    .filter(Boolean)
    .join(" · ");
  return [
    `💰 Последние опубликованные цены: ${values.join("; ")}`,
    metadata ? `   ${metadata}` : "",
  ].filter(Boolean);
}

function formatSourceEvidence(station) {
  const evidence = station.availabilityBySource || {};
  const refs = [...new Set((station.sourceRefs || []).map((item) => item.source))];
  return refs.map((source) => {
    const name = sourceText[source] || source;
    const signal = evidence[source];
    if (!signal) {
      if (source === "multigo") return `${name} — только карточка АЗС`;
      if (source === "yandex") return `${name} — цены, не наличие`;
      if (source === "benzup") return `${name} — каталог и цены`;
      return `${name} — без сигнала наличия`;
    }

    const details = [];
    if (signal.detail) details.push(`«${signal.detail}»`);
    if (Number.isFinite(Number(signal.operationsCount))) details.push(`${Number(signal.operationsCount)} операций`);
    if (Number.isFinite(Number(signal.confirmations))) details.push(`${Number(signal.confirmations)} подтверждений`);
    if (Number.isFinite(Number(signal.confidence)) && Number(signal.confidence) > 0) {
      details.push(`уверенность ${Math.round(Number(signal.confidence) * 100)}%`);
    }
    const label = statusText[signal.overallStatus]?.replace(/^[^\p{L}]+/u, "") || "нет данных";
    return `${name} — ${label}${details.length ? ` (${details.join(", ")})` : ""}`;
  }).join("; ");
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
