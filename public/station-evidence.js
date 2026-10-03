// Shared browser/server policy. Dates refer to source events, never poll time.
export const PAYMENT_WINDOW_MS = 30 * 60_000;
export const SERVICE_REPORT_MAX_AGE_MS = 60 * 60_000;
export const BANK_SOURCES = new Set(["tbank", "alfa", "sber"]);

export function hasOnlyBankStatuses(evidence = {}) {
  const known = Object.entries(evidence).filter(([, signal]) => signal.overallStatus && signal.overallStatus !== "no_data");
  return known.length > 0 && known.every(([source]) => BANK_SOURCES.has(source));
}

export function recentPaymentTimes(values = [], now = Date.now()) {
  return [...new Set(values.map(Date.parse).filter((time) => Number.isFinite(time)
    && time <= now && now - time <= PAYMENT_WINDOW_MS))]
    .sort((left, right) => right - left).slice(0, 2).map((time) => new Date(time).toISOString());
}

export function serviceReportFromText(detail, observedAt) {
  const value = String(detail || "").trim();
  if (/(?:слив (?:топлива )?заверш[её]н|обслуживание возобновлено|заправк[аи] возобновлен[аы])/iu.test(value)) {
    return { serviceStatus: "operating", serviceObservedAt: observedAt, serviceReason: "Обслуживание возобновлено" };
  }
  if (/(?:^(?:слив|при[её]м) топлива(?:\s|[.,·]|$)|(?:ид[её]т|вед[её]тся) (?:слив|при[её]м) топлива|обслуживание (?:временно )?приостановлено|(?:азс|заправка) временно закрыта|не заправляют)/iu.test(value)) {
    return { serviceStatus: "paused", serviceObservedAt: observedAt, serviceReason: /слив|при[её]м/iu.test(value) ? "Слив топлива" : "Обслуживание приостановлено" };
  }
  return {};
}

export function latestServiceReport(evidence = {}, now = Date.now()) {
  const reports = Object.entries(evidence).filter(([, signal]) => {
    const time = Date.parse(signal.serviceObservedAt);
    return ["paused", "operating"].includes(signal.serviceStatus) && Number.isFinite(time)
      && time <= now && now - time <= SERVICE_REPORT_MAX_AGE_MS;
  }).sort((left, right) => Date.parse(right[1].serviceObservedAt) - Date.parse(left[1].serviceObservedAt)
    || Number(right[1].serviceStatus === "paused") - Number(left[1].serviceStatus === "paused"));
  return reports.length ? { source: reports[0][0], status: reports[0][1].serviceStatus,
    observedAt: reports[0][1].serviceObservedAt, reason: reports[0][1].serviceReason } : null;
}

export function bankPaymentPair(evidence = {}, now = Date.now()) {
  if (latestServiceReport(evidence, now)?.status === "paused") return null;
  const events = Object.entries(evidence).flatMap(([source, signal]) => {
    if (!BANK_SOURCES.has(source) || signal.overallStatus !== "available") return [];
    return recentPaymentTimes([...(signal.paymentTimes || []), signal.observedAt], now)
      .map((time) => ({ source, time }));
  });
  const times = recentPaymentTimes(events.map((event) => event.time), now);
  if (times.length < 2) return null;
  const latest = Date.parse(times[0]);
  const newerNegative = Object.values(evidence).some((other) => other.overallStatus === "not_available"
    && Date.parse(other.observedAt) >= latest && Date.parse(other.observedAt) <= now);
  if (newerNegative) return null;
  const sources = [...new Set(times.map((time) => events.find((event) => event.time === time).source))];
  return { sources, times };
}
