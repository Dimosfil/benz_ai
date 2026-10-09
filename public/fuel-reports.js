// Shared report policy for server aggregation and browser age refreshes.
export const FUEL_REPORT_MAX_AGE_MS = 60 * 60_000;
export const REPORTABLE_FUELS = Object.freeze(["92", "95"]);
const INDIRECT_SOURCES = new Set(["tbank", "alfa", "sber"]);

export function mergeFuelReports(...groups) {
  const latest = new Map();
  for (const report of groups.flat()) {
    if (!isFreshFuelReport(report)) continue;
    for (const fuel of report.fuels) {
      if (!latest.has(fuel) || Date.parse(report.observedAt) > Date.parse(latest.get(fuel).observedAt)) {
        latest.set(fuel, { ...report, fuels: [fuel] });
      }
    }
  }
  return [...latest.values()];
}

export function isFreshFuelReport(report, now = Date.now()) {
  const time = Date.parse(report?.observedAt);
  return report?.status === "not_available" && Array.isArray(report.fuels)
    && report.fuels.length > 0 && report.fuels.every((fuel) => REPORTABLE_FUELS.includes(fuel))
    && Number.isFinite(time) && time <= now && now - time < FUEL_REPORT_MAX_AGE_MS;
}

export function reportedFuelStatus(station, fuel, now = Date.now()) {
  const report = (station.fuelReports || []).filter((item) => isFreshFuelReport(item, now) && item.fuels.includes(fuel))
    .sort((left, right) => Date.parse(right.observedAt) - Date.parse(left.observedAt))[0];
  if (!report) return null;
  const laterConfirmation = Object.entries(station.availabilityBySource || {}).some(([source, signal]) => {
    const time = Date.parse(signal.observedAt);
    return !INDIRECT_SOURCES.has(source) && signal.fuelStatus?.[fuel] === "available"
      && (source !== "yandex" || Number(signal.confirmations) >= 2)
      && Number.isFinite(time) && time > Date.parse(report.observedAt)
      && time <= now && now - time < FUEL_REPORT_MAX_AGE_MS;
  });
  return laterConfirmation ? null : "not_available";
}

export function activeReportedFuels(station, now = Date.now()) {
  return REPORTABLE_FUELS.filter((fuel) => reportedFuelStatus(station, fuel, now));
}

export function resolveFuelReportStatus(station, selected, baseFuelStatus, baseOverallStatus, now = Date.now()) {
  const reported = activeReportedFuels(station, now);
  if (!reported.length || (selected.length && !selected.some((fuel) => reported.includes(fuel)))) return null;
  const fuels = selected.length ? selected : [...new Set([...Object.keys(station.fuelStatus || {}), ...reported])];
  const known = fuels.map((fuel) => reportedFuelStatus(station, fuel, now) || baseFuelStatus(fuel))
    .filter((status) => status && (selected.length || status !== "no_data"));
  // A general positive signal cannot identify diesel or cancel a petrol report.
  if (!selected.length && baseOverallStatus === "available" && !known.some((status) => status !== "not_available")) {
    return "maybe_available";
  }
  return known.length && new Set(known).size === 1 ? known[0] : "maybe_available";
}
