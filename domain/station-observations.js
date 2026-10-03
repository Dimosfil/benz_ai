import { BANK_SOURCES, latestServiceReport, recentPaymentTimes } from "../public/station-evidence.js";

// Only called for user-requested station snapshots. No timer or network work.
export class StationObservations {
  constructor({ maxStations = 5000 } = {}) {
    this.maxStations = maxStations;
    this.records = new Map();
  }

  observe(stations, now = Date.now()) {
    for (const [key, record] of this.records) {
      if (!recentPaymentTimes(record.paymentTimes, now).length
        && !latestServiceReport({ saved: record }, now)) this.records.delete(key);
    }
    return stations.map((station) => {
      const evidence = { ...(station.availabilityBySource || {}) };
      for (const [source, signal] of Object.entries(evidence)) {
        const id = station.sourceRefs?.find((ref) => ref.source === source)?.externalId
          || (station.source === source ? station.externalId : null);
        if (!id) continue;
        const key = `${source}:${id}`;
        const saved = this.records.get(key) || {};
        const times = BANK_SOURCES.has(source) ? recentPaymentTimes([...(saved.paymentTimes || []),
          ...(signal.paymentTimes || []), signal.observedAt], now) : [];
        const report = latestServiceReport({ saved, incoming: signal }, now);
        const retained = { ...signal, paymentTimes: times,
          ...(report ? { serviceStatus: report.status, serviceObservedAt: report.observedAt, serviceReason: report.reason } : {}),
        };
        this.records.delete(key);
        if (times.length || report) this.records.set(key, { paymentTimes: times,
          ...(report ? { serviceStatus: report.status, serviceObservedAt: report.observedAt, serviceReason: report.reason } : {}),
        });
        while (this.records.size > this.maxStations) this.records.delete(this.records.keys().next().value);
        evidence[source] = retained;
      }
      return { ...station, availabilityBySource: evidence };
    });
  }
}
