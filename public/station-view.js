export const labels = Object.freeze({
  available: "Вероятно есть",
  maybe_available: "Возможно есть",
  not_available: "Вероятно нет",
  no_data: "Нет данных",
});

export const sourceNames = Object.freeze({
  tbank: "T‑Bank Fuel",
  alfa: "Alfa AZS",
  sber: "Sber AZS",
  gdebenz: "ГдеБЕНЗ",
  benzup: "BenzUp",
  multigo: "Multigo",
  yandex: "Яндекс Карты",
});

const fuelNames = Object.freeze({ DT: "ДТ", LPG: "Пропан", CNG: "Метан" });
const formatter = new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short" });
const RELIABLE_AVAILABILITY_MIN_SIGNALS = 2;
const RELIABLE_AVAILABILITY_MIN_AGREEMENT = 80;
const PAYMENT_SOURCES = new Set(["tbank", "alfa", "sber"]);

export function fuelName(type) {
  return fuelNames[type] || `АИ‑${type}`;
}

function rawSelectionStatus(station, selected) {
  if (!selected.length) return station.overallStatus;
  const values = selected.map((type) => station.fuelStatus[type]).filter(Boolean);
  if (!values.length) return "no_data";
  return new Set(values).size === 1 ? values[0] : "maybe_available";
}

function sourceStatuses(station, selected = []) {
  return Object.values(station.availabilityBySource || {}).map((signal) => {
    if (!selected.length) return signal.overallStatus;
    const values = selected.map((type) => signal.fuelStatus?.[type]).filter(Boolean);
    if (!values.length) return "no_data";
    return new Set(values).size === 1 ? values[0] : "maybe_available";
  }).filter((status) => status && status !== "no_data");
}

function confidenceFromStatuses(statuses) {
  if (!statuses.length) return null;
  const counts = statuses.reduce((result, status) => {
    result[status] = (result[status] || 0) + 1;
    return result;
  }, {});
  const matching = Math.max(...Object.values(counts));
  return {
    matching,
    total: statuses.length,
    percent: Math.round((matching / statuses.length) * 100),
  };
}

export function selectionStatus(station, selected = []) {
  const status = rawSelectionStatus(station, selected);
  if (status !== "available") return status;
  const confidence = confidenceFromStatuses(sourceStatuses(station, selected));
  const reliable = confidence
    && confidence.total >= RELIABLE_AVAILABILITY_MIN_SIGNALS
    && confidence.percent >= RELIABLE_AVAILABILITY_MIN_AGREEMENT;
  return reliable ? "available" : "maybe_available";
}

export function stationSources(station) {
  const names = (station.sourceRefs || [{ source: station.source }]).map((ref) => sourceNames[ref.source] || ref.source);
  return [...new Set(names)].join(" + ");
}

export function stationFuelText(station, selected = []) {
  return stationFuelEntries(station, selected)
    .map(({ name, status }) => `${name}: ${labels[status] || status}`)
    .join(" · ") || "По видам топлива данных нет";
}

export function stationPriceText(station) {
  return Object.entries(station.prices || {}).sort(([a], [b]) => a.localeCompare(b, "ru", { numeric: true }))
    .map(([type, price]) => `${fuelName(type)} — ${Number(price.value).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽`)
    .join(" · ") || "Цены не опубликованы";
}

export function stationFuelEntries(station, selected = []) {
  const fuels = selected.length
    ? selected
    : [...new Set([...Object.keys(station.fuelStatus || {}), ...Object.keys(station.prices || {})])];
  return fuels.sort((a, b) => a.localeCompare(b, "ru", { numeric: true })).map((type) => {
    const price = Number(station.prices?.[type]?.value);
    return {
      type,
      name: fuelName(type),
      status: selectionStatus(station, [type]),
      price: Number.isFinite(price) ? price : null,
    };
  });
}

export function stationConfidence(station, selected = []) {
  if (rawSelectionStatus(station, selected) === "no_data") return null;
  return confidenceFromStatuses(sourceStatuses(station, selected));
}

export function stationLastPaymentAt(station) {
  const timestamps = Object.entries(station.availabilityBySource || {})
    .filter(([source]) => PAYMENT_SOURCES.has(source))
    .map(([, signal]) => signal.observedAt)
    .filter((value) => Number.isFinite(Date.parse(value)));
  return timestamps.length ? new Date(Math.max(...timestamps.map(Date.parse))).toISOString() : null;
}

export function stationFreshText(station) {
  const lastPaymentAt = stationLastPaymentAt(station);
  const payment = lastPaymentAt
    ? `Последняя оплата: ${formatter.format(new Date(lastPaymentAt))}`
    : "Данных о последней оплате нет";
  return station.priceUpdatedAt ? `${payment} · цены: ${station.priceUpdatedAt}` : payment;
}

export function minimumPrice(station) {
  const prices = Object.values(station.prices || {}).map((price) => Number(price.value)).filter(Number.isFinite);
  return prices.length ? Math.min(...prices) : null;
}
