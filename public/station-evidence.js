// Shared browser/server policy. Dates refer to source events, never poll time.
export const PAYMENT_WINDOW_MS = 30 * 60_000;
export const SERVICE_REPORT_MAX_AGE_MS = 60 * 60_000;
export const BANK_SOURCES = new Set(["tbank", "alfa", "sber"]);
export const PETROL_FUELS = new Set(["80", "92", "95", "98", "100", "98/100"]);
export const AVAILABILITY_MAX_AGE_MS = 60 * 60_000;

export function signalFuelTime(signal, fuel) {
  return signal.fuelObservedAt && Object.hasOwn(signal.fuelObservedAt, fuel)
    ? signal.fuelObservedAt[fuel] : signal.observedAt;
}

export function petrolObservedAt(signal) {
  if (signal.fuelObservedAt) {
    const times = Object.entries(signal.fuelObservedAt).filter(([fuel]) => PETROL_FUELS.has(fuel))
      .map(([, value]) => Date.parse(value)).filter(Number.isFinite);
    return times.length ? new Date(Math.max(...times)).toISOString() : null;
  }
  const fuels = Object.keys(signal.fuelStatus || {});
  return fuels.length && !fuels.some((fuel) => PETROL_FUELS.has(fuel)) ? null : signal.observedAt || null;
}

export function freshFuelSignal(signal, fuel, now = Date.now()) {
  const time = Date.parse(signalFuelTime(signal, fuel));
  return Number.isFinite(time) && time <= now
    && now - time <= (BANK_SOURCES.has(signal.source) ? PAYMENT_WINDOW_MS : AVAILABILITY_MAX_AGE_MS);
}

function combineStatuses(values, any = false) {
  const known = values.filter((value) => value && value !== "no_data");
  if (!known.length) return "no_data";
  if (any && known.includes("available")) return "available";
  if (any && known.includes("maybe_available")) return "maybe_available";
  return new Set(known).size === 1 ? known[0] : "maybe_available";
}

export function evidenceFuels(evidence = {}, selected = []) {
  return selected.length ? selected.filter((fuel) => PETROL_FUELS.has(fuel)) : [...new Set(Object.values(evidence)
    .flatMap((signal) => Object.keys(signal.fuelStatus || {})).filter((fuel) => PETROL_FUELS.has(fuel)))];
}

export function fuelSignalStatus(source, signal, fuel, now = Date.now()) {
  const status = signal.fuelStatus?.[fuel] || "no_data";
  return status === "available" && !freshFuelSignal({ ...signal, source }, fuel, now)
    ? "maybe_available" : status;
}

export function selectionSignalStatus(source, signal, fuels, any = false, now = Date.now()) {
  return combineStatuses(fuels.map((fuel) => fuelSignalStatus(source, signal, fuel, now)), any);
}

function hasFuelApproval(evidence, fuel, now) {
  return Object.entries(evidence).some(([source, signal]) => {
    if (fuelSignalStatus(source, signal, fuel, now) !== "available") return false;
    if (BANK_SOURCES.has(source)) return Number.isFinite(Date.parse(signal.fuelObservedAt?.[fuel]));
    return source !== "yandex" || Number(signal.confirmations) >= 2;
  });
}

export function availabilityStatus(evidence = {}, selected = [], now = Date.now()) {
  if (selected.length > 1) {
    const statuses = selected.map((fuel) => availabilityStatus(evidence, [fuel], now));
    return new Set(statuses).size === 1 ? statuses[0] : "maybe_available";
  }
  const fuels = evidenceFuels(evidence, selected);
  const statuses = Object.entries(evidence).map(([source, signal]) =>
    selectionSignalStatus(source, signal, fuels, !selected.length, now));
  const status = combineStatuses(statuses);
  // A price, a general payment or a diesel-only report cannot approve petrol.
  if (availabilityPaymentPair(evidence, selected, now)) return "available";
  return status === "available" ? "maybe_available" : status;
}

export function availabilityPaymentPair(evidence = {}, selected = [], now = Date.now()) {
  const approved = evidenceFuels(evidence, selected).filter((fuel) => Object.entries(evidence)
    .some(([source, signal]) => fuelSignalStatus(source, signal, fuel, now) === "available")
    && hasFuelApproval(evidence, fuel, now));
  return approved.length ? bankPaymentPair(evidence, now, approved) : null;
}

export function recentPaymentTimes(values = [], now = Date.now()) {
  return [...new Set(values.map(Date.parse).filter((time) => Number.isFinite(time)
    && time <= now && now - time <= PAYMENT_WINDOW_MS))]
    .sort((left, right) => right - left).slice(0, 2).map((time) => new Date(time).toISOString());
}

export function mergeFuelPaymentTimes(left = {}, right = {}, now = Date.now()) {
  return Object.fromEntries([...new Set([...Object.keys(left), ...Object.keys(right)])]
    .map((fuel) => [fuel, recentPaymentTimes([...(left[fuel] || []), ...(right[fuel] || [])], now)]));
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

export function bankPaymentPair(evidence = {}, now = Date.now(), fuels = null) {
  if (latestServiceReport(evidence, now)?.status === "paused") return null;
  const events = Object.entries(evidence).flatMap(([source, signal]) => {
    if (!BANK_SOURCES.has(source) || signal.overallStatus !== "available") return [];
    const relevant = fuels?.filter((fuel) => fuelSignalStatus(source, signal, fuel, now) === "available");
    if (fuels && !relevant.length) return [];
    const values = fuels && signal.paymentTimesByFuel
      ? relevant.flatMap((fuel) => [...(signal.paymentTimesByFuel[fuel] || []), signalFuelTime(signal, fuel)])
      : [...(signal.paymentTimes || []), signal.observedAt];
    return recentPaymentTimes(values, now)
      .map((time) => ({ source, time }));
  });
  const times = recentPaymentTimes(events.map((event) => event.time), now);
  if (times.length < 2) return null;
  const latest = Date.parse(times[0]);
  const newerNegative = Object.values(evidence).some((other) => {
    if (!fuels) return other.overallStatus === "not_available"
      && Date.parse(other.observedAt) >= latest && Date.parse(other.observedAt) <= now;
    return fuels.some((fuel) => other.fuelStatus?.[fuel] === "not_available"
      && Date.parse(signalFuelTime(other, fuel)) >= latest && Date.parse(signalFuelTime(other, fuel)) <= now)
      || (!Object.keys(other.fuelStatus || {}).length && other.overallStatus === "not_available"
        && Date.parse(other.observedAt) >= latest && Date.parse(other.observedAt) <= now);
  });
  if (newerNegative) return null;
  const sources = [...new Set(times.map((time) => events.find((event) => event.time === time).source))];
  return { sources, times };
}
