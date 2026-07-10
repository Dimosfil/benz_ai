export const labels = Object.freeze({
  available: "Вероятно есть",
  maybe_available: "Возможно есть",
  not_available: "Вероятно нет",
  no_data: "Нет данных",
});

export const sourceNames = Object.freeze({
  tbank: "T‑Bank Fuel",
  sber: "Sber AZS",
  gdebenz: "ГдеБЕНЗ",
  benzup: "BenzUp",
  multigo: "Multigo",
  yandex: "Яндекс Карты",
});

const fuelNames = Object.freeze({ DT: "ДТ", LPG: "Пропан", CNG: "Метан" });
const formatter = new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short" });

export function fuelName(type) {
  return fuelNames[type] || `АИ‑${type}`;
}

export function selectionStatus(station, selected) {
  if (!selected.length) return station.overallStatus;
  const values = selected.map((type) => station.fuelStatus[type]).filter(Boolean);
  if (!values.length) return "no_data";
  return new Set(values).size === 1 ? values[0] : "maybe_available";
}

export function stationSources(station) {
  const names = (station.sourceRefs || [{ source: station.source }]).map((ref) => sourceNames[ref.source] || ref.source);
  return [...new Set(names)].join(" + ");
}

export function stationFuelText(station, selected = []) {
  const entries = selected.length
    ? selected.map((type) => [type, station.fuelStatus[type] || "no_data"])
    : Object.entries(station.fuelStatus);
  return entries.sort(([a], [b]) => a.localeCompare(b, "ru", { numeric: true }))
    .map(([type, value]) => `${fuelName(type)}: ${labels[value] || value}`).join(" · ") || "По видам топлива данных нет";
}

export function stationPriceText(station) {
  return Object.entries(station.prices || {}).sort(([a], [b]) => a.localeCompare(b, "ru", { numeric: true }))
    .map(([type, price]) => `${fuelName(type)} — ${Number(price.value).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽`)
    .join(" · ") || "Цены не опубликованы";
}

export function stationFreshText(station) {
  const availability = station.lastTransactionAt
    ? `Наличие: ${formatter.format(new Date(station.lastTransactionAt))}`
    : "Время проверки неизвестно";
  return station.priceUpdatedAt ? `${availability} · цены: ${station.priceUpdatedAt}` : availability;
}

export function minimumPrice(station) {
  const prices = Object.values(station.prices || {}).map((price) => Number(price.value)).filter(Number.isFinite);
  return prices.length ? Math.min(...prices) : null;
}
