import { sourceNames } from "./station-view.js";

const roleNames = Object.freeze({
  availability: "Наличие топлива",
  availability_and_prices: "Наличие и цены",
  prices: "Цены",
  price_verification: "Проверка цен",
  catalog: "Каталог АЗС",
});

function sourceState(state) {
  if (state.available) return { key: "active", label: "Работает" };
  if (state.configured === false) return { key: "not-configured", label: "Не подключён" };
  return { key: "unavailable", label: "Недоступен" };
}

function addMetric(metrics, label, value) {
  if (Number.isFinite(Number(value))) metrics.push(`${label}: ${Number(value).toLocaleString("ru-RU")}`);
}

export function sourceOverviewRows(sources = {}, sourceRequests = {}) {
  return Object.entries(sourceNames).map(([key, name]) => {
    const state = sources[key] || { configured: false, available: false };
    const metrics = [];
    addMetric(metrics, "Запросов", sourceRequests[key]);
    addMetric(metrics, "Получено объектов", state.returned);
    addMetric(metrics, "Вошло в выдачу", state.included);
    addMetric(metrics, "Проверено", state.checked);
    if (Number.isFinite(Number(state.refreshSeconds))) metrics.push(`Обновление: каждые ${Number(state.refreshSeconds).toLocaleString("ru-RU")} с`);
    return {
      key,
      name,
      role: roleNames[state.role] || "Дополнительный источник",
      status: sourceState(state),
      metrics,
      error: state.error || "",
    };
  });
}

export function nonSourceWarnings(warnings = [], sources = {}) {
  const sourceErrors = new Set(Object.values(sources).map((state) => state?.error).filter(Boolean));
  return warnings.filter((warning) => !sourceErrors.has(warning));
}
