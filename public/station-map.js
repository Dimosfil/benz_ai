import {
  labels,
  selectionStatus,
  stationFreshText,
  stationFuelText,
  stationPriceText,
  stationSources,
} from "./station-view.js";

const STATUS_COLORS = new Set(["available", "maybe_available", "not_available", "no_data"]);

export function hasMapCoordinates(station) {
  if (station?.lat == null || station?.lon == null) return false;
  return Number.isFinite(Number(station.lat))
    && Number.isFinite(Number(station.lon))
    && Number(station.lat) >= -90
    && Number(station.lat) <= 90
    && Number(station.lon) >= -180
    && Number(station.lon) <= 180;
}

export function stationMapStatus(station, selectedFuels = []) {
  const status = selectionStatus(station, selectedFuels);
  return STATUS_COLORS.has(status) ? status : "no_data";
}

function text(tag, value, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = value;
  return node;
}

function popupFor(station, selectedFuels) {
  const status = stationMapStatus(station, selectedFuels);
  const popup = document.createElement("article");
  popup.className = "map-popup";
  popup.append(
    text("p", stationSources(station), "map-popup-sources"),
    text("h3", station.name || "АЗС"),
    text("p", station.address || "Адрес не указан", "map-popup-address"),
  );
  const facts = document.createElement("div");
  facts.className = "map-popup-facts";
  facts.append(
    text("span", labels[status] || labels.no_data, `badge ${status}`),
    text("p", stationFuelText(station, selectedFuels)),
    text("p", stationPriceText(station)),
    text("p", stationFreshText(station)),
  );
  popup.append(facts);
  if (station.detail) popup.append(text("p", station.detail, "map-popup-detail"));

  const links = document.createElement("div");
  links.className = "map-popup-links";
  [[station.links?.yandex, "Яндекс Карты"], [station.links?.twoGis, "2ГИС"]].forEach(([href, label]) => {
    if (!href) return;
    const link = text("a", label);
    link.href = href;
    link.target = "_blank";
    link.rel = "noreferrer";
    links.append(link);
  });
  if (links.childElementCount) popup.append(links);
  return popup;
}

function markerIcon(L, status) {
  return L.divIcon({
    className: "station-marker-wrap",
    html: `<span class="station-marker ${status}" aria-hidden="true"><span>⛽</span></span>`,
    iconSize: [38, 46],
    iconAnchor: [19, 44],
    popupAnchor: [0, -38],
  });
}

function clusterIcon(L, cluster) {
  const count = cluster.getChildCount();
  const size = count >= 100 ? "large" : count >= 10 ? "medium" : "small";
  return L.divIcon({
    className: "station-cluster-wrap",
    html: `<span class="station-cluster ${size}">${count}</span>`,
    iconSize: [46, 46],
  });
}

export function createStationMap({ container, message, count }) {
  const L = window.L;
  if (!L?.map || !L?.markerClusterGroup) {
    message.hidden = false;
    message.textContent = "Карта не загрузилась. Список АЗС доступен ниже.";
    return { render() {}, clear() {} };
  }

  const map = L.map(container, { zoomControl: true, preferCanvas: true });
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);
  const markers = L.markerClusterGroup({
    chunkedLoading: true,
    maxClusterRadius: 52,
    showCoverageOnHover: false,
    iconCreateFunction: (cluster) => clusterIcon(L, cluster),
  });
  map.addLayer(markers);
  map.setView([55.75, 37.62], 5);

  function clear() {
    markers.clearLayers();
    count.textContent = "0 АЗС";
  }

  function render(stations, selectedFuels, { fit = false } = {}) {
    markers.clearLayers();
    const valid = stations.filter(hasMapCoordinates);
    const layers = valid.map((station) => {
      const status = stationMapStatus(station, selectedFuels);
      return L.marker([Number(station.lat), Number(station.lon)], {
        icon: markerIcon(L, status),
        title: station.name || "АЗС",
        alt: `${station.name || "АЗС"}: ${labels[status] || labels.no_data}`,
      }).bindPopup(() => popupFor(station, selectedFuels), { maxWidth: 340, minWidth: 250 });
    });
    markers.addLayers(layers);
    count.textContent = `${valid.length.toLocaleString("ru-RU")} АЗС`;
    message.hidden = valid.length > 0;
    message.textContent = valid.length ? "" : "По выбранным фильтрам на карте нет АЗС.";
    if (fit && valid.length) {
      const bounds = markers.getBounds();
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [34, 34], maxZoom: 13 });
    }
    requestAnimationFrame(() => map.invalidateSize());
  }

  return { render, clear };
}
