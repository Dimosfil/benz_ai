import { selectionStatus } from "./station-view.js";

export function normalizeSelectedFuels(selected, available) {
  const unique = [...new Set(selected)].filter((value) => available.includes(value));
  return unique.length === available.length ? [] : unique;
}

export function filterStations(stations, { fuels = [], statuses = [], text = "" } = {}) {
  const query = text.trim().toLocaleLowerCase("ru-RU");
  return stations.filter((station) => {
    const hasSelectedFuel = !fuels.length || fuels.some((type) => station.fuelStatus[type]);
    const actualStatus = selectionStatus(station, fuels);
    const matchesStatus = !statuses.length || statuses.includes(actualStatus);
    const matchesText = !query || `${station.name} ${station.address}`.toLocaleLowerCase("ru-RU").includes(query);
    return hasSelectedFuel && matchesStatus && matchesText;
  });
}
