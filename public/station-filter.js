import { selectionStatus } from "./station-view.js";
import { PETROL_FUELS } from "./station-evidence.js";

export function normalizeSelectedFuels(selected, available) {
  const petrol = available.filter((fuel) => PETROL_FUELS.has(fuel));
  const unique = [...new Set(selected)].filter((value) => petrol.includes(value));
  return unique.length === petrol.length ? [] : unique;
}

export function filterStations(stations, { fuels = [], statuses = [], text = "" } = {}) {
  fuels = fuels.filter((fuel) => PETROL_FUELS.has(fuel));
  const query = text.trim().toLocaleLowerCase("ru-RU");
  return stations.filter((station) => {
    const hasSelectedFuel = !fuels.length || fuels.some((type) => station.fuelStatus?.[type] || station.prices?.[type]);
    const actualStatus = selectionStatus(station, fuels);
    const matchesStatus = !statuses.length || statuses.includes(actualStatus);
    const searchableText = [station.name, station.address, ...(station.nameAliases || []), ...(station.addressAliases || [])].join(" ");
    const matchesText = !query || searchableText.toLocaleLowerCase("ru-RU").includes(query);
    return hasSelectedFuel && matchesStatus && matchesText;
  });
}
