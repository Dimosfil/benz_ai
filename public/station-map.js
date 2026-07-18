import {
  formatPrice,
  labels,
  selectionStatus,
  stationConfidence,
  stationFuelEntries,
  stationFreshText,
  stationSources,
} from "./station-view.js";
import { filterStations } from "./station-filter.js";
import { fetchNdjson } from "./api-client.js";

const STATUS_COLORS = new Set(["available", "maybe_available", "not_available", "no_data"]);
const STATUS_CHART_COLORS = Object.freeze({
  available: "#12b76a",
  maybe_available: "#f59e0b",
  not_available: "#ef4444",
  no_data: "#64748b",
});
const STATUS_CHART_ORDER = Object.freeze(Object.keys(STATUS_CHART_COLORS));
const MIN_VIEWPORT_ZOOM = 8;
const VIEWPORT_DEBOUNCE_MS = 400;
const VIEWPORT_REQUEST_TIMEOUT_MS = 18_000;
const VIEWPORT_PREFETCH_RATIO = 0.45;
const VIEWPORT_RETENTION_RATIO = 1;
const STATUS_HEADLINES = Object.freeze({
  available: "Топливо, вероятно, есть",
  maybe_available: "Топливо, возможно, есть",
  not_available: "Топлива, вероятно, нет",
  no_data: "Данных о наличии нет",
});
const STATUS_ICONS = Object.freeze({ available: "✓", maybe_available: "?", not_available: "!", no_data: "·" });

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

export function clusterStatusChart(statuses = []) {
  const normalized = statuses.length
    ? statuses.map((status) => STATUS_COLORS.has(status) ? status : "no_data")
    : ["no_data"];
  const counts = new Map(STATUS_CHART_ORDER.map((status) => [status, 0]));
  normalized.forEach((status) => counts.set(status, counts.get(status) + 1));
  const present = STATUS_CHART_ORDER.filter((status) => counts.get(status) > 0);
  if (present.length === 1) return STATUS_CHART_COLORS[present[0]];

  let consumed = 0;
  const segments = present.map((status) => {
    const start = consumed / normalized.length * 100;
    consumed += counts.get(status);
    const end = consumed / normalized.length * 100;
    return `${STATUS_CHART_COLORS[status]} ${start}% ${end}%`;
  });
  return `conic-gradient(${segments.join(", ")})`;
}

export function stationViewportUrl({ south, north, west, east }) {
  const params = new URLSearchParams({
    mode: "viewport",
    minLat: Number(south).toFixed(6),
    maxLat: Number(north).toFixed(6),
    minLon: Number(west).toFixed(6),
    maxLon: Number(east).toFixed(6),
  });
  return `/api/stations/stream?${params}`;
}

export function padViewportBounds(bounds, ratio) {
  const latitudePadding = (bounds.north - bounds.south) * ratio;
  const longitudePadding = (bounds.east - bounds.west) * ratio;
  return {
    south: Math.max(-90, bounds.south - latitudePadding),
    north: Math.min(90, bounds.north + latitudePadding),
    west: Math.max(-180, bounds.west - longitudePadding),
    east: Math.min(180, bounds.east + longitudePadding),
  };
}

export function stationWithinBounds(station, bounds) {
  if (!hasMapCoordinates(station)) return false;
  const latitude = Number(station.lat);
  const longitude = Number(station.lon);
  return latitude >= bounds.south && latitude <= bounds.north
    && longitude >= bounds.west && longitude <= bounds.east;
}

export function uncoveredViewportBounds(loaded, desired) {
  if (!loaded) return [desired];
  const overlaps = loaded.west < desired.east && loaded.east > desired.west
    && loaded.south < desired.north && loaded.north > desired.south;
  if (!overlaps) return [desired];

  const areas = [];
  if (desired.north > loaded.north) {
    areas.push({ ...desired, south: Math.max(desired.south, loaded.north) });
  }
  if (desired.south < loaded.south) {
    areas.push({ ...desired, north: Math.min(desired.north, loaded.south) });
  }

  const overlapSouth = Math.max(desired.south, loaded.south);
  const overlapNorth = Math.min(desired.north, loaded.north);
  if (overlapNorth > overlapSouth && desired.west < loaded.west) {
    areas.push({ south: overlapSouth, north: overlapNorth, west: desired.west, east: Math.min(desired.east, loaded.west) });
  }
  if (overlapNorth > overlapSouth && desired.east > loaded.east) {
    areas.push({ south: overlapSouth, north: overlapNorth, west: Math.max(desired.west, loaded.east), east: desired.east });
  }
  return areas.filter((area) => area.north > area.south && area.east > area.west);
}

function plainMapBounds(bounds) {
  return {
    south: bounds.getSouth(),
    north: bounds.getNorth(),
    west: bounds.getWest(),
    east: bounds.getEast(),
  };
}

function stationSourceIdentityKeys(station) {
  return (station.sourceRefs || (station.source ? [{ source: station.source, externalId: station.externalId }] : []))
    .filter((ref) => ref?.source && String(ref.externalId ?? ""))
    .map((ref) => `source:${ref.source}:${String(ref.externalId)}`);
}

function stationCacheKey(station) {
  const sourceKey = stationSourceIdentityKeys(station)[0];
  if (sourceKey) return sourceKey;
  const latitude = Number(station.lat).toFixed(5);
  const longitude = Number(station.lon).toFixed(5);
  const name = String(station.name || "").trim().toLocaleLowerCase("ru-RU");
  return `point:${latitude}:${longitude}:${name}`;
}

export function mergeStationCache(stationCache, identityIndex, stationKeys, stations) {
  for (const station of stations) {
    if (!hasMapCoordinates(station)) continue;
    const identities = stationSourceIdentityKeys(station);
    const existingKey = identities
      .map((identity) => identityIndex.get(identity))
      .find((key) => key && stationCache.has(key));
    const key = existingKey || stationCacheKey(station);
    const previous = stationCache.get(key);
    const previousPriceTime = Date.parse(previous?.priceUpdatedAt);
    const incomingPriceTime = Date.parse(station.priceUpdatedAt);
    const incomingPrices = station.prices || {};
    const incomingPricesAreNewer = Object.keys(incomingPrices).length > 0
      && ((!Number.isFinite(previousPriceTime) && Number.isFinite(incomingPriceTime))
        || (Number.isFinite(incomingPriceTime) && incomingPriceTime >= previousPriceTime)
        || (!Number.isFinite(previousPriceTime) && !Number.isFinite(incomingPriceTime)));
    const merged = previous ? {
      ...previous,
      ...station,
      sourceRefs: [...new Map([...(previous.sourceRefs || []), ...(station.sourceRefs || [])]
        .map((ref) => [`${ref.source}:${String(ref.externalId ?? "")}`, ref])).values()],
      prices: incomingPricesAreNewer
        ? { ...(previous.prices || {}), ...incomingPrices }
        : { ...incomingPrices, ...(previous.prices || {}) },
      links: { ...(previous.links || {}), ...(station.links || {}) },
      availabilityBySource: { ...(previous.availabilityBySource || {}), ...(station.availabilityBySource || {}) },
      nameAliases: [...new Set([...(previous.nameAliases || []), ...(station.nameAliases || [])])],
      addressAliases: [...new Set([...(previous.addressAliases || []), ...(station.addressAliases || [])])],
      priceUpdatedAt: incomingPricesAreNewer
        ? station.priceUpdatedAt || previous.priceUpdatedAt || null
        : previous.priceUpdatedAt || station.priceUpdatedAt || null,
      yandexOrgId: station.yandexOrgId || previous.yandexOrgId || null,
    } : station;
    stationCache.set(key, merged);
    stationKeys.set(station, key);
    stationKeys.set(merged, key);
    stationSourceIdentityKeys(merged).forEach((identity) => identityIndex.set(identity, key));
  }
}

function text(tag, value, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = value;
  return node;
}

function element(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function appendLink(container, href, label, className = "") {
  if (!href) return;
  const link = text("a", label, className);
  link.href = href;
  link.target = "_blank";
  link.rel = "noreferrer";
  container.append(link);
}

function popupFor(station, selectedFuels) {
  const status = stationMapStatus(station, selectedFuels);
  const confidence = stationConfidence(station, selectedFuels);
  const popup = document.createElement("article");
  popup.className = `map-popup map-popup-${status}`;

  const header = element("header", "map-popup-header");
  header.append(text("span", (station.name || "АЗС").trim().slice(0, 1).toUpperCase(), "map-popup-monogram"));
  const identity = element("div", "map-popup-identity");
  identity.append(
    text("h3", station.name || "АЗС"),
    text("p", station.address || "Адрес не указан", "map-popup-address"),
  );
  header.append(identity);
  popup.append(header);

  const statusCard = element("section", `map-popup-status ${status}`);
  const statusTop = element("div", "map-popup-status-top");
  statusTop.append(
    text("span", STATUS_ICONS[status], "map-popup-status-icon"),
    text("strong", STATUS_HEADLINES[status] || labels.no_data, "map-popup-status-title"),
  );
  statusCard.append(statusTop);
  if (confidence) {
    const confidenceRow = element("div", "map-popup-confidence");
    const confidenceCopy = element("div", "map-popup-confidence-copy");
    confidenceCopy.append(
      text("span", "Согласованность источников"),
      text("strong", `${confidence.percent}%`),
    );
    const meter = element("div", "map-popup-meter");
    const meterValue = element("span");
    meterValue.style.width = `${confidence.percent}%`;
    meter.append(meterValue);
    confidenceRow.append(
      confidenceCopy,
      meter,
      text("small", `${confidence.matching} из ${confidence.total} сигналов совпадают`),
    );
    statusCard.append(confidenceRow);
  } else {
    statusCard.append(text("p", status === "no_data"
      ? "Источники не передали актуальные данные о наличии."
      : "Статус рассчитан по доступным сигналам агрегатора.", "map-popup-status-note"));
  }
  if (station.detail) statusCard.append(text("p", station.detail, "map-popup-detail"));
  popup.append(statusCard);

  const fuels = stationFuelEntries(station, selectedFuels);
  if (fuels.length) {
    const fuelSection = element("section", "map-popup-section");
    fuelSection.append(text("h4", "Топливо и цены"));
    const fuelList = element("div", "map-popup-fuel-list");
    fuels.forEach((fuel) => {
      const row = element("div", "map-popup-fuel-row");
      const name = element("div", "map-popup-fuel-name");
      name.append(
        text("i", "", `map-popup-fuel-dot ${fuel.status}`),
        text("strong", fuel.name),
        text("span", labels[fuel.status] || labels.no_data),
      );
      row.append(name, text("strong", fuel.price == null
        ? "—"
        : formatPrice(fuel.price, fuel.currency), "map-popup-price"));
      fuelList.append(row);
    });
    fuelSection.append(fuelList);
    popup.append(fuelSection);
  }

  const meta = element("section", "map-popup-meta");
  meta.append(
    text("p", stationFreshText(station), "map-popup-fresh"),
    text("p", stationSources(station), "map-popup-sources"),
  );
  popup.append(meta);

  const links = document.createElement("div");
  links.className = "map-popup-links";
  const primaryLink = station.links?.yandex || station.links?.twoGis;
  appendLink(links, primaryLink, station.links?.yandex ? "Открыть в Яндекс Картах ↗" : "Открыть в 2ГИС ↗", "map-popup-route");
  if (station.links?.yandex && station.links?.twoGis) appendLink(links, station.links.twoGis, "Открыть в 2ГИС", "map-popup-secondary-link");
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
  const statuses = cluster.getAllChildMarkers().map((marker) => marker.options.stationStatus);
  const statusChart = clusterStatusChart(statuses);
  return L.divIcon({
    className: "station-cluster-wrap",
    html: `<span class="station-cluster ${size}" style="--cluster-status-chart:${statusChart}"><span>${count}</span></span>`,
    iconSize: [46, 46],
  });
}

export function createStationMap({ container, message, count }) {
  const L = window.L;
  if (!L?.map || !L?.markerClusterGroup) {
    message.hidden = false;
    message.textContent = "Карта не загрузилась. Список АЗС доступен ниже.";
    return { showStations() {}, setFilters() {}, locateUser() {}, clear() {}, activate() {}, deactivate() {} };
  }

  const map = L.map(container, { zoomControl: true, preferCanvas: true });
  map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noreferrer">Leaflet</a>');
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
  const stationCache = new Map();
  const stationIdentityIndex = new Map();
  const stationKeys = new WeakMap();
  const markerCache = new Map();
  let loadedBounds = null;
  let filters = { fuels: [], statuses: [], text: "" };
  let loadTimer = null;
  let activeRequest = null;
  let requestSequence = 0;
  let userLocated = false;
  let locatePending = null;
  let userLayer = null;
  let activePopupStationKey = null;
  let failedSources = [];

  function showMessage(value) {
    message.textContent = value || "";
    message.hidden = !value;
  }

  function visibleFilteredStations() {
    const visibleBounds = plainMapBounds(map.getBounds());
    return filterStations(viewportStations, filters)
      .filter((station) => stationWithinBounds(station, visibleBounds));
  }

  function updateVisibleCount({ loading = false } = {}) {
    const visible = visibleFilteredStations();
    count.textContent = `${visible.length.toLocaleString("ru-RU")} АЗС${loading ? " · догружаем…" : ""}`;
    count.title = failedSources.length ? `Не ответили источники: ${failedSources.join(", ")}` : "";
    if (!loading) showMessage(
      visible.length || !viewportStations.length || activePopupStationKey
        ? ""
        : "По выбранным фильтрам на карте нет АЗС.",
    );
    return visible.length;
  }

  function syncStationCache() {
    viewportStations = [...stationCache.values()];
  }

  function mergeStations(stations) {
    mergeStationCache(stationCache, stationIdentityIndex, stationKeys, stations);
    syncStationCache();
  }

  function pruneStationCache(bounds) {
    let changed = false;
    for (const [key, station] of stationCache) {
      if (stationWithinBounds(station, bounds)) continue;
      stationCache.delete(key);
      for (const [identity, indexedKey] of stationIdentityIndex) {
        if (indexedKey === key) stationIdentityIndex.delete(identity);
      }
      changed = true;
    }
    if (changed) syncStationCache();
    return changed;
  }

  function renderMarkers() {
    const loading = arguments[0]?.loading === true;
    const filtered = filterStations(viewportStations, filters);
    const valid = filtered.filter(hasMapCoordinates);
    const nextKeys = new Set();
    const added = [];
    const statusChanged = [];

    for (const station of valid) {
      const key = stationKeys.get(station) || stationCacheKey(station);
      nextKeys.add(key);
      const status = stationMapStatus(station, filters.fuels);
      const existing = markerCache.get(key);
      if (existing) {
        existing.options.title = station.name || "АЗС";
        existing.options.alt = `${station.name || "АЗС"}: ${labels[status] || labels.no_data}`;
        existing.getElement?.()?.setAttribute("title", existing.options.title);
        existing.getElement?.()?.setAttribute("aria-label", existing.options.alt);
        if (existing.options.stationStatus !== status) {
          existing.options.stationStatus = status;
          existing.setIcon(markerIcon(L, status));
          statusChanged.push(existing);
        }
        continue;
      }

      const marker = L.marker([Number(station.lat), Number(station.lon)], {
        icon: markerIcon(L, status),
        stationStatus: status,
        stationKey: key,
        title: station.name || "АЗС",
        alt: `${station.name || "АЗС"}: ${labels[status] || labels.no_data}`,
      }).bindPopup(
        () => popupFor(stationCache.get(key) || station, filters.fuels),
        { autoPan: false, maxWidth: 410, minWidth: 300, className: "station-popup" },
      );
      marker.on("popupopen", () => {
        activePopupStationKey = key;
        showMessage("");
      });
      marker.on("popupclose", () => {
        if (activePopupStationKey === key) activePopupStationKey = null;
        updateVisibleCount();
      });
      markerCache.set(key, marker);
      added.push(marker);
    }

    for (const [key, marker] of markerCache) {
      if (nextKeys.has(key)) continue;
      markers.removeLayer(marker);
      markerCache.delete(key);
    }
    if (added.length) markers.addLayers(added);
    if (statusChanged.length && markers.refreshClusters) markers.refreshClusters(statusChanged);
    updateVisibleCount({ loading });
    requestAnimationFrame(() => map.invalidateSize({ pan: false }));
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
      loadedBounds = null;
      stationCache.clear();
      stationIdentityIndex.clear();
      viewportStations = [];
      markers.clearLayers();
      markerCache.clear();
      activePopupStationKey = null;
      failedSources = [];
      count.textContent = "0 АЗС";
      showMessage("Приблизьте карту, чтобы загрузить АЗС в видимой области.");
      return;
    }

    const visibleBounds = plainMapBounds(map.getBounds());
    const desiredBounds = padViewportBounds(visibleBounds, VIEWPORT_PREFETCH_RATIO);
    const retentionBounds = padViewportBounds(visibleBounds, VIEWPORT_RETENTION_RATIO);
    const requestBounds = uncoveredViewportBounds(loadedBounds, desiredBounds);
    if (!requestBounds.length) {
      if (pruneStationCache(retentionBounds)) {
        loadedBounds = desiredBounds;
        renderMarkers();
      } else updateVisibleCount();
      return;
    }

    activeRequest?.abort();
    const request = new AbortController();
    activeRequest = request;
    const sequence = ++requestSequence;
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      request.abort();
    }, VIEWPORT_REQUEST_TIMEOUT_MS);
    const hasCachedStations = stationCache.size > 0;
    failedSources = [];
    updateVisibleCount({ loading: true });
    if (!hasCachedStations) showMessage("Загружаем АЗС рядом с видимой областью…");
    try {
      await Promise.all(requestBounds.map((bounds) => fetchNdjson(
        stationViewportUrl(bounds),
        { signal: request.signal },
        (data) => {
          if (request.signal.aborted || sequence !== requestSequence) return;
          mergeStations(Array.isArray(data.stations) ? data.stations : []);
          if (Array.isArray(data.failedSources)) {
            failedSources = [...new Set([...failedSources, ...data.failedSources])];
          }
          if (stationCache.size) showMessage("");
          renderMarkers({ loading: true });
        },
      )));
      if (request.signal.aborted || sequence !== requestSequence) return;
      loadedBounds = desiredBounds;
      pruneStationCache(retentionBounds);
      renderMarkers();
    } catch (error) {
      if (sequence !== requestSequence || (request.signal.aborted && !timedOut)) return;
      updateVisibleCount();
      showMessage(timedOut
        ? "Источники отвечают слишком долго. Передвиньте карту или повторите попытку позже."
        : error instanceof Error ? error.message : "Не удалось загрузить АЗС для этой области.");
    } finally {
      clearTimeout(timeout);
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
    loadedBounds = null;
    stationCache.clear();
    stationIdentityIndex.clear();
    viewportStations = [];
    markers.clearLayers();
    markerCache.clear();
    activePopupStationKey = null;
    failedSources = [];
    count.textContent = "0 АЗС";
    showMessage("");
  }

  function setFilters(nextFilters) {
    filters = nextFilters;
    if (viewportStations.length) renderMarkers();
  }

  function focusStations(stations) {
    map.invalidateSize({ pan: false });
    const valid = stations.filter(hasMapCoordinates);
    if (!valid.length) return false;
    const bounds = L.latLngBounds(valid.map((station) => [Number(station.lat), Number(station.lon)]));
    if (!bounds.isValid()) return false;
    map.fitBounds(bounds, { padding: [34, 34], maxZoom: 13 });
    return true;
  }

  function showStations(stations, {
    fit = false,
    protectUserLocation = false,
    focus = stations,
    deferViewportLoad = false,
  } = {}) {
    if (protectUserLocation && userLocated) {
      if (!deferViewportLoad) scheduleViewportLoad({ immediate: true });
      return;
    }
    loadedBounds = null;
    stationCache.clear();
    stationIdentityIndex.clear();
    mergeStations(stations);
    if (deferViewportLoad) return;
    renderMarkers();
    map.invalidateSize({ pan: false });
    if (fit && focusStations(focus)) {
      // The moveend event schedules loading for the newly focused viewport.
    } else if (!deferViewportLoad) {
      scheduleViewportLoad({ immediate: true });
    }
  }

  function deactivate() {
    cancelViewportLoad();
    requestSequence += 1;
  }

  function activate(focus = null) {
    deactivate();
    loadedBounds = null;
    map.invalidateSize({ pan: false });
    if (Array.isArray(focus) && focus.length) focusStations(focus);
    renderMarkers({ loading: true });
    scheduleViewportLoad({ immediate: true });
  }

  return { showStations, focusStations, setFilters, locateUser, clear, activate, deactivate };
}
