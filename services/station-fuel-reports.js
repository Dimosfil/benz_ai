import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { isFreshFuelReport, REPORTABLE_FUELS } from "../public/fuel-reports.js";

const SOURCES = new Set(["tbank", "alfa", "sber", "gdebenz", "benzup", "multigo", "yandex"]);
const identity = (ref) => `${ref.source}:${ref.externalId}`;
function validRefs(refs) {
  return Array.isArray(refs) && refs.length > 0 && refs.length <= 14
    && refs.every((ref) => SOURCES.has(ref?.source) && typeof ref.externalId === "string"
      && ref.externalId.length > 0 && ref.externalId.length <= 200);
}
function refsOf(station) {
  return station.sourceRefs?.length ? station.sourceRefs
    : station.source && station.externalId ? [{ source: station.source, externalId: String(station.externalId) }] : [];
}
function overlaps(left, right) {
  const keys = new Set(left.map(identity));
  return right.some((ref) => keys.has(identity(ref)));
}
function failure(message, statusCode) {
  return Object.assign(new Error(message), { statusCode });
}

// One server process owns the file. Reports contain public station IDs, no visitor identity.
export class StationFuelReports {
  constructor({ file = "data/station-reports/reports.json", maxStations = 5000, maxReports = 1000 } = {}) {
    this.file = resolve(file);
    this.maxStations = maxStations;
    this.maxReports = maxReports;
    this.stations = new Map();
    this.reports = [];
    this.available = true;
    this.queue = Promise.resolve();
    this.ready = this.load();
  }

  async load() {
    try {
      const state = JSON.parse(await readFile(this.file, "utf8"));
      if (state.version !== 1 || !Array.isArray(state.reports) || state.reports.length > this.maxReports
        || state.reports.some((report) => !validRefs(report.sourceRefs) || report.status !== "not_available"
          || !Array.isArray(report.fuels) || !report.fuels.length
          || report.fuels.some((fuel) => !REPORTABLE_FUELS.includes(fuel))
          || !Number.isFinite(Date.parse(report.observedAt)))) throw new Error("Invalid report file");
      this.reports = state.reports.filter((report) => isFreshFuelReport(report))
        .map(({ sourceRefs, fuels, status, observedAt }) => ({ sourceRefs: sourceRefs.map(({ source, externalId }) => ({ source, externalId })),
          fuels, status, observedAt }));
    } catch (error) {
      if (error.code !== "ENOENT") {
        this.available = false;
        console.error("Station fuel reports: storage unavailable; reporting disabled.");
      }
    }
  }

  attach(stations, now = Date.now()) {
    this.reports = this.reports.filter((report) => isFreshFuelReport(report, now));
    return stations.map((station) => {
      const sourceRefs = refsOf(station);
      if (!validRefs(sourceRefs)) return station;
      for (const ref of sourceRefs) {
        const key = identity(ref);
        this.stations.delete(key);
        this.stations.set(key, station);
      }
      while (this.stations.size > this.maxStations) this.stations.delete(this.stations.keys().next().value);
      const fuelReports = this.reports.filter((report) => overlaps(report.sourceRefs, sourceRefs));
      const { fuelReports: previous, baseAvailability, ...base } = station;
      const reporting = this.available ? {} : { reportingAvailable: false,
        reportingUnavailableReason: "Сообщения временно недоступны: хранилище не удалось открыть." };
      return fuelReports.length ? { ...base, ...reporting, fuelReports } : { ...base, ...reporting };
    });
  }

  submit(payload, now = Date.now()) {
    const operation = this.queue.then(async () => {
      await this.ready;
      if (!this.available) throw failure("Сообщения временно недоступны: хранилище не удалось открыть.", 503);
      if (!validRefs(payload?.sourceRefs) || payload.checkedOnSite !== true
        || !Array.isArray(payload.fuels) || !payload.fuels.length || payload.fuels.length > REPORTABLE_FUELS.length
        || new Set(payload.fuels).size !== payload.fuels.length
        || payload.fuels.some((fuel) => !REPORTABLE_FUELS.includes(fuel))) {
        throw failure("Укажите АИ‑92 и/или АИ‑95 и подтвердите проверку на этой АЗС сейчас.", 400);
      }
      const matches = new Set(payload.sourceRefs.map((ref) => this.stations.get(identity(ref))).filter(Boolean));
      if (!matches.size) throw failure("АЗС не найдена. Обновите карту и откройте её карточку снова.", 404);
      const station = [...matches][0];
      const sourceRefs = [...refsOf(station)];
      const remaining = [...matches].slice(1);
      while (remaining.length) {
        const index = remaining.findIndex((candidate) => overlaps(refsOf(candidate), sourceRefs));
        if (index < 0) throw failure("Идентификаторы относятся к разным АЗС. Обновите карточку.", 400);
        const [candidate] = remaining.splice(index, 1);
        for (const ref of refsOf(candidate)) if (!sourceRefs.some((known) => identity(known) === identity(ref))) sourceRefs.push(ref);
      }
      const fuelReport = { sourceRefs: sourceRefs.map(({ source, externalId }) => ({ source, externalId })),
        fuels: [...payload.fuels], status: "not_available", observedAt: new Date(now).toISOString() };
      const reports = [...this.reports.filter((report) => isFreshFuelReport(report, now))
        .map((report) => overlaps(report.sourceRefs, sourceRefs)
          ? { ...report, fuels: report.fuels.filter((fuel) => !payload.fuels.includes(fuel)) } : report)
        .filter((report) => report.fuels.length), fuelReport].slice(-this.maxReports);
      try {
        await mkdir(dirname(this.file), { recursive: true });
        await writeFile(`${this.file}.tmp`, JSON.stringify({ version: 1, reports }) + "\n", { encoding: "utf8", mode: 0o600 });
        await rename(`${this.file}.tmp`, this.file);
      } catch {
        throw failure("Не удалось сохранить сообщение. Попробуйте позже.", 503);
      }
      this.reports = reports;
      return { ...station, sourceRefs, fuelReports: reports.filter((report) => overlaps(report.sourceRefs, sourceRefs)) };
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
}
