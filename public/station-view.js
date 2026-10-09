import { bankPaymentPair, hasOnlyBankStatuses, latestServiceReport } from "./station-evidence.js";
import { activeReportedFuels, isFreshFuelReport, resolveFuelReportStatus } from "./fuel-reports.js";

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

const fuelNames = Object.freeze({ DT: "ДТ", LPG: "Пропан", CNG: "Метан", OTHER: "Другое" });
const formatter = new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Moscow" });
const paymentTimeFormatter = new Intl.DateTimeFormat("ru-RU", { timeStyle: "medium", timeZone: "Europe/Moscow" });
const RELIABLE_AVAILABILITY_MIN_SIGNALS = 2;
const RELIABLE_AVAILABILITY_MIN_AGREEMENT = 80;
const FRESH_PAYMENT_MAX_AGE_MS = 60 * 60_000;
const RECENT_CROWD_CONFIRMATION_MS = 60 * 60_000;
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
    if (!selected.length) return freshnessAwareSignalStatus(signal, signal.overallStatus);
    const values = selected
      .map((type) => freshnessAwareSignalStatus(signal, signal.fuelStatus?.[type]))
      .filter(Boolean);
    if (!values.length) return "no_data";
    return new Set(values).size === 1 ? values[0] : "maybe_available";
  }).filter((status) => status && status !== "no_data");
}

function freshnessAwareSignalStatus(signal, status) {
  if (status !== "available") return status;
  const observedAt = Date.parse(signal.observedAt);
  if (!Number.isFinite(observedAt)) return status;
  if (observedAt > Date.now() + 5 * 60_000 || Date.now() - observedAt > FRESH_PAYMENT_MAX_AGE_MS) {
    return "maybe_available";
  }
  return status;
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

function baseSelectionStatus(station, selected = []) {
  const paused = latestServiceReport(station.availabilityBySource)?.status === "paused";
  if (!paused && ((!selected.length && bankPaymentPair(station.availabilityBySource))
    || hasRecentCrowdConfirmation(station, selected))) return "available";
  const status = rawSelectionStatus(station, selected);
  if (status !== "available") return status;
  if (paused) return "maybe_available";
  if (!selected.length && hasOnlyBankStatuses(station.availabilityBySource)) return "maybe_available";
  const statuses = sourceStatuses(station, selected);
  const confidence = confidenceFromStatuses(statuses);
  const reliable = confidence
    && confidence.total >= RELIABLE_AVAILABILITY_MIN_SIGNALS
    && confidence.percent >= RELIABLE_AVAILABILITY_MIN_AGREEMENT
    && statuses.every((value) => value === "available");
  return reliable ? "available" : "maybe_available";
}

export function selectionStatus(station, selected = []) {
  const base = station.baseAvailability ? { ...station, ...station.baseAvailability } : station;
  return resolveFuelReportStatus(station, selected, (fuel) => baseSelectionStatus(base, [fuel]),
    baseSelectionStatus(base), Date.now()) || baseSelectionStatus(base, selected);
}

export function stationFuelReportText(station) {
  const active = activeReportedFuels(station);
  return (station.fuelReports || []).filter((report) => isFreshFuelReport(report))
    .map((report) => {
      const fuels = report.fuels.filter((fuel) => active.includes(fuel));
      return fuels.length ? `Сообщение посетителя: ${fuels.map(fuelName).join(" / ")} нет · ${formatter.format(new Date(report.observedAt))} МСК. Действует один час; дизель оценивается отдельно.` : "";
    }).filter(Boolean).join(" ");
}

export function stationServiceText(station) {
  const report = latestServiceReport(station.availabilityBySource);
  if (!report) return "";
  const age = formatAge(Math.max(0, Date.now() - Date.parse(report.observedAt)));
  const reason = report.status === "paused" ? report.reason || "Обслуживание приостановлено" : "Обслуживание возобновлено";
  return `${reason} · ${sourceNames[report.source] || report.source} · ${age} назад`;
}

export function stationPaymentPairText(station) {
  const pair = bankPaymentPair(station.availabilityBySource);
  if (!pair) return "";
  const times = [...pair.times].reverse().map((time) => paymentTimeFormatter.format(new Date(time)));
  const banks = pair.sources.map((source) => sourceNames[source]).join(" и ");
  return `Две разные операции по данным ${banks} за последние 30 минут: ${times.join(" и ")} МСК. Это повышает вероятность наличия топлива, но не гарантирует работу колонок сейчас.`;
}

export function hasRecentCrowdConfirmation(station, selected = [], now = Date.now()) {
  return Object.entries(station.availabilityBySource || {}).some(([source, signal]) => {
    if (source !== "yandex" || Number(signal.confirmations) < 2) return false;
    const status = selected.length
      ? selected.map((fuel) => signal.fuelStatus?.[fuel]).filter(Boolean)
      : [signal.overallStatus];
    if (!status.length || status.some((value) => value !== "available")) return false;
    const observedAt = Date.parse(signal.observedAt);
    return Number.isFinite(observedAt)
      && observedAt <= now + 5 * 60_000
      && now - observedAt <= RECENT_CROWD_CONFIRMATION_MS;
  });
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
    .filter(([, price]) => Number.isFinite(Number(price?.value)) && Number(price.value) > 0)
    .map(([type, price]) => `${fuelName(type)} — ${formatPrice(price.value, price.currency)}`)
    .join(" · ") || "Нет данных о ценах";
}

export function stationPriceNote(station) {
  if (Object.values(station.prices || {}).some((price) => Number(price?.value) > 0)) return "";
  if (station.yandexOrgId) return "Подтверждённых данных о ценах этой АЗС нет.";
  const sources = new Set((station.sourceRefs || []).map((ref) => ref.source));
  if (sources.size && [...sources].every((source) => ["gdebenz", "sber", "tbank", "multigo"].includes(source))) {
    return "Источники этой АЗС не передают цены.";
  }
  return "Подтверждённых данных о ценах этой АЗС нет.";
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
      price: Number.isFinite(price) && price > 0 ? price : null,
      currency: station.prices?.[type]?.currency || "RUB",
    };
  });
}

export function formatPrice(value, currency = "RUB") {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return "—";
  try {
    return new Intl.NumberFormat("ru-RU", { style: "currency", currency: String(currency || "RUB").toUpperCase() }).format(number);
  } catch {
    return `${number.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency || "RUB"}`;
  }
}

export function stationConfidence(station, selected = []) {
  if (activeReportedFuels(station).some((fuel) => !selected.length || selected.includes(fuel))) return null;
  if (rawSelectionStatus(station, selected) === "no_data") return null;
  return confidenceFromStatuses(sourceStatuses(station, selected));
}

export function stationLastPaymentAt(station) {
  const latest = latestBankOperation(station);
  return latest ? new Date(Date.parse(latest[1].observedAt)).toISOString() : null;
}

function latestBankOperation(station) {
  return Object.entries(station.availabilityBySource || {})
    .filter(([source, signal]) => PAYMENT_SOURCES.has(source)
      && Number.isFinite(Date.parse(signal.observedAt))
      && Date.parse(signal.observedAt) <= Date.now() + 5 * 60_000)
    .sort((left, right) => Date.parse(right[1].observedAt) - Date.parse(left[1].observedAt))[0] || null;
}

export function stationPaymentText(station) {
  const latest = latestBankOperation(station);
  if (!latest) return "Данных о последней оплате нет";
  const [source, signal] = latest;
  const ageMs = Math.max(0, Date.now() - Date.parse(signal.observedAt));
  const stale = ageMs > FRESH_PAYMENT_MAX_AGE_MS;
  return `${stale ? "⚠ " : ""}Последняя операция по данным ${sourceNames[source]}: ${formatter.format(new Date(signal.observedAt))} МСК · ${formatAge(ageMs)} назад${stale ? " · данные устарели" : ""}. Работа колонок сейчас не подтверждена.`;
}

export function stationFreshText(station) {
  const payment = stationPaymentText(station);
  const queue = stationQueueText(station);
  const priceTime = Date.parse(station.priceUpdatedAt);
  const priceDate = Number.isFinite(priceTime) ? formatter.format(new Date(priceTime)) : station.priceUpdatedAt;
  const freshness = priceDate ? `${payment} · цены: ${priceDate}` : payment;
  return [stationFuelReportText(station), stationServiceText(station), queue, freshness].filter(Boolean).join(" · ");
}

export function stationQueueText(station) {
  const now = Date.now();
  const signals = Object.entries(station.availabilityBySource || {}).filter(([, signal]) => signal.queueLabel);
  if (!signals.length) return "";
  const dated = signals.filter(([, signal]) => Number.isFinite(Date.parse(signal.observedAt))
    && Date.parse(signal.observedAt) <= now + 5 * 60_000)
    .sort((left, right) => Date.parse(right[1].observedAt) - Date.parse(left[1].observedAt));
  if (!dated.length) return "Очередь: время сообщения неизвестно, текущая оценка недоступна";
  const [source, signal] = dated[0];
  const ageMs = Math.max(0, now - Date.parse(signal.observedAt));
  const origin = `${sourceNames[source] || source} · ${formatAge(ageMs)} назад`;
  if (ageMs > RECENT_CROWD_CONFIRMATION_MS) return `Очередь: данные устарели (${origin}), текущая оценка неизвестна`;
  const confirmations = signal.confirmations ? ` · ${signal.confirmations} подтверждения` : "";
  return `${signal.queueLabel} · ${origin}${confirmations}. Ожидание сейчас может отличаться.`;
}

function formatAge(ageMs) {
  const minutes = Math.max(0, Math.floor(ageMs / 60_000));
  if (minutes < 1) return "только что";
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours} ч ${remainder} мин` : `${hours} ч`;
}

export function minimumPrice(station) {
  const prices = Object.values(station.prices || {}).map((price) => Number(price.value)).filter((value) => Number.isFinite(value) && value > 0);
  return prices.length ? Math.min(...prices) : null;
}
