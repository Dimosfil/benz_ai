import {
  labels,
  selectionStatus,
  stationFreshText,
  stationFuelText,
  stationPriceText,
  stationSources,
} from "./station-view.js";
import { filterStations } from "./station-filter.js";
import { fetchJson } from "./api-client.js";

const STATUS_COLORS = new Set(["available", "maybe_available", "not_available", "no_data"]);
const MIN_VIEWPORT_ZOOM = 8;
const VIEWPORT_DEBOUNCE_MS = 400;

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

export function stationViewportUrl({ south, north, west, east }) {
  const params = new URLSearchParams({
    minLat: Number(south).toFixed(6),
    maxLat: Number(north).toFixed(6),
    minLon: Number(west).toFixed(6),
    maxLon: Number(east).toFixed(6),
  });
  return `/api/stations?${params}`;
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
    return { showStations() {}, setFilters() {}, locateUser() {}, clear() {} };
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
  let viewportStations = [];
  let filters = { fuels: [], statuses: [], text: "" };
  let loadTimer = null;
  let activeRequest = null;
  let requestSequence = 0;
  let userLocated = false;
  let locatePending = null;
  let userLayer = null;

  function showMessage(value) {
    message.textContent = value || "";
    message.hidden = !value;
  }

  function renderMarkers() {
    markers.clearLayers();
    const filtered = filterStations(viewportStations, filters);
    const valid = filtered.filter(hasMapCoordinates);
    const layers = valid.map((station) => {
      const status = stationMapStatus(station, filters.fuels);
      return L.marker([Number(station.lat), Number(station.lon)], {
        icon: markerIcon(L, status),
        title: station.name || "АЗС",
        alt: `${station.name || "АЗС"}: ${labels[status] || labels.no_data}`,
      }).bindPopup(() => popupFor(station, filters.fuels), { maxWidth: 340, minWidth: 250 });
    });
    markers.addLayers(layers);
    count.textContent = `${valid.length.toLocaleString("ru-RU")} АЗС`;
    showMessage(valid.length || !viewportStations.length ? "" : "По выбранным фильтрам на карте нет АЗС.");
    requestAnimationFrame(() => map.invalidateSize());
  }

  function cancelViewportLoad() {
    clearTimeout(loadTimer);
    loadTimer = null;
    activeRequest?.abort();
    activeRequest = null;
  }

  async function loadViewport() {
    loadTimer = null;
    if (map.getZoom() < MIN_VIEWPORT_ZOOM) {
      activeRequest?.abort();
      activeRequest = null;
      viewportStations = [];
      markers.clearLayers();
      count.textContent = "0 АЗС";
      showMessage("Приблизьте карту, чтобы загрузить АЗС в видимой области.");
      return;
    }

    activeRequest?.abort();
    const request = new AbortController();
    activeRequest = request;
    const sequence = ++requestSequence;
    viewportStations = [];
    markers.clearLayers();
    count.textContent = "…";
    showMessage("Загружаем АЗС в видимой области…");
    const bounds = map.getBounds();
    try {
      const data = await fetchJson(stationViewportUrl({
        south: bounds.getSouth(),
        north: bounds.getNorth(),
        west: bounds.getWest(),
        east: bounds.getEast(),
      }), { signal: request.signal });
      if (request.signal.aborted || sequence !== requestSequence) return;
      viewportStations = Array.isArray(data.stations) ? data.stations : [];
      renderMarkers();
      if (!viewportStations.length) showMessage("В видимой области АЗС не найдены.");
    } catch (error) {
      if (request.signal.aborted || sequence !== requestSequence) return;
      viewportStations = [];
      markers.clearLayers();
      count.textContent = "0 АЗС";
      showMessage(error instanceof Error ? error.message : "Не удалось загрузить АЗС для этой области.");
    } finally {
      if (activeRequest === request) activeRequest = null;
    }
  }

  function scheduleViewportLoad({ immediate = false } = {}) {
    clearTimeout(loadTimer);
    loadTimer = setTimeout(loadViewport, immediate ? 0 : VIEWPORT_DEBOUNCE_MS);
  }

  function locateUser(showError = false) {
    if (!navigator.geolocation) {
      if (showError) showMessage("Браузер не поддерживает определение местоположения.");
      return Promise.resolve(false);
    }
    if (locatePending) return locatePending;
    locatePending = new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition((position) => {
        userLocated = true;
        const latlng = [position.coords.latitude, position.coords.longitude];
        map.invalidateSize();
        if (userLayer) userLayer.setLatLng(latlng);
        else userLayer = L.circleMarker(latlng, {
          radius: 7,
          weight: 3,
          color: "#fff",
          fillColor: "#1768d4",
          fillOpacity: 1,
        }).bindTooltip("Ваше местоположение").addTo(map);
        map.setView(latlng, Math.max(map.getZoom(), 13));
        resolve(true);
      }, () => {
        if (showError) showMessage("Не удалось определить местоположение. Проверьте разрешение браузера.");
        resolve(false);
      }, { enableHighAccuracy: false, timeout: 8_000, maximumAge: 5 * 60_000 });
    }).finally(() => { locatePending = null; });
    return locatePending;
  }

  const LocateControl = L.Control.extend({
    options: { position: "topright" },
    onAdd() {
      const button = L.DomUtil.create("button", "map-locate-button");
      button.type = "button";
      button.title = "Показать моё местоположение";
      button.setAttribute("aria-label", button.title);
      button.textContent = "⌖";
      L.DomEvent.disableClickPropagation(button);
      L.DomEvent.on(button, "click", () => locateUser(true));
      return button;
    },
  });
  map.addControl(new LocateControl());
  map.on("moveend", () => scheduleViewportLoad());

  function clear() {
    cancelViewportLoad();
    requestSequence += 1;
    viewportStations = [];
    markers.clearLayers();
    count.textContent = "0 АЗС";
    showMessage("");
  }

  function setFilters(nextFilters) {
    filters = nextFilters;
    if (viewportStations.length) renderMarkers();
  }

  function showStations(stations, { fit = false, protectUserLocation = false } = {}) {
    if (protectUserLocation && userLocated) {
      scheduleViewportLoad({ immediate: true });
      return;
    }
    viewportStations = stations;
    renderMarkers();
    map.invalidateSize();
    const valid = stations.filter(hasMapCoordinates);
    if (fit && valid.length) {
      const temporaryBounds = L.latLngBounds(valid.map((station) => [Number(station.lat), Number(station.lon)]));
      if (temporaryBounds.isValid()) map.fitBounds(temporaryBounds, { padding: [34, 34], maxZoom: 13 });
    } else {
      scheduleViewportLoad({ immediate: true });
    }
  }

  return { showStations, setFilters, locateUser, clear };
}
