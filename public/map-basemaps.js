export const BASEMAPS = Object.freeze([
  { id: "osm", name: "OpenStreetMap" },
  { id: "topo", name: "OpenTopoMap" },
  { id: "liberty", name: "OpenFreeMap · Liberty" },
  { id: "bright", name: "OpenFreeMap · Bright" },
  { id: "positron", name: "OpenFreeMap · Positron" },
]);

const STORAGE_KEY = "benz.map-style";
const OSM_CREDIT = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
let vectorAssets;

function asset(tag, url) {
  return new Promise((resolve, reject) => {
    const element = document.createElement(tag);
    const timer = setTimeout(() => finish(new Error("Map asset timeout")), 20000);
    function finish(error) {
      clearTimeout(timer);
      element.onload = element.onerror = null;
      if (error) { element.remove(); reject(error); }
      else resolve();
    }
    element.onload = () => finish();
    element.onerror = () => finish(new Error("Map asset unavailable"));
    if (tag === "link") { element.rel = "stylesheet"; element.href = url; }
    else element.src = url;
    document.head.append(element);
  });
}

export function loadVectorAssets() {
  vectorAssets ??= (async () => {
    await Promise.all([
      asset("link", "https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.css"),
      asset("script", "https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.js"),
    ]);
    await asset("script", "https://unpkg.com/@maplibre/maplibre-gl-leaflet@0.1.4/leaflet-maplibre-gl.js");
  })().catch((error) => { vectorAssets = null; throw error; });
  return vectorAssets;
}

// Only the base layer changes; station layers, viewport and popup state belong to Leaflet.
export function createBasemapSwitcher({ L, map, notify = () => {}, loadVector = loadVectorAssets, storage }) {
  let activeLayer;
  let selected = "osm";
  let sequence = 0;
  let cancelPending = () => {};
  const remember = (id) => { try { storage?.setItem(STORAGE_KEY, id); } catch {} };
  function raster(id) {
    return L.tileLayer(id === "topo"
      ? "https://tile.opentopomap.org/{z}/{x}/{y}.png"
      : "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      ...(id === "topo" ? { maxNativeZoom: 17 } : {}),
      attribution: id === "topo" ? `${OSM_CREDIT}, SRTM | <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)` : OSM_CREDIT,
    });
  }
  function replace(layer) {
    if (activeLayer) map.removeLayer(activeLayer);
    activeLayer = layer;
    layer.addTo(map);
  }
  replace(raster("osm"));

  async function select(id) {
    if (!BASEMAPS.some((item) => item.id === id)) id = "osm";
    const request = ++sequence;
    cancelPending();
    notify(id, "Загрузка карты…");
    try {
      if (id === "osm" || id === "topo") {
        replace(raster(id));
      } else {
        await loadVector();
        if (request !== sequence) return;
        const layer = L.maplibreGL({
          style: `https://tiles.openfreemap.org/styles/${id}`,
          attributionControl: { customAttribution: `${OSM_CREDIT} | <a href="https://openfreemap.org">OpenFreeMap</a> | <a href="https://openmaptiles.org">OpenMapTiles</a>` },
        });
        replace(layer);
        await new Promise((resolve, reject) => {
          const gl = layer.getMaplibreMap();
          const timer = setTimeout(() => finish(new Error("Map load timeout")), 20000);
          const loaded = () => finish();
          const failed = () => finish(new Error("Map unavailable"));
          function finish(error) {
            clearTimeout(timer);
            gl.off("load", loaded); gl.off("error", failed);
            cancelPending = () => {};
            if (error) reject(error); else resolve();
          }
          cancelPending = () => finish();
          gl.on("load", loaded); gl.on("error", failed);
        });
      }
      if (request !== sequence) return;
      selected = id;
      remember(id);
      notify(id, "");
    } catch {
      if (request !== sequence) return;
      replace(raster("osm"));
      selected = "osm";
      remember("osm");
      notify("osm", "Не удалось загрузить оформление. Включён OpenStreetMap.");
    }
  }
  return { select, get selected() { return selected; } };
}

export function addBasemapControl(L, map) {
  let storage;
  try { storage = window.localStorage; } catch {}
  let switcher;
  const Control = L.Control.extend({
    options: { position: "topright" },
    onAdd() {
      const box = L.DomUtil.create("div", "map-basemap-control");
      const label = document.createElement("label");
      label.textContent = "Вид карты";
      const select = document.createElement("select");
      select.setAttribute("aria-label", "Вид карты");
      for (const item of BASEMAPS) {
        const option = document.createElement("option");
        option.value = item.id; option.textContent = item.name;
        select.append(option);
      }
      const status = document.createElement("div");
      status.setAttribute("role", "status");
      status.hidden = true;
      label.append(select); box.append(label, status);
      L.DomEvent.disableClickPropagation(box);
      L.DomEvent.disableScrollPropagation(box);
      switcher = createBasemapSwitcher({ L, map, storage, notify(id, text) {
        select.value = id; status.textContent = text; status.hidden = !text;
      } });
      select.addEventListener("change", () => void switcher.select(select.value));
      return box;
    },
  });
  map.addControl(new Control());
  let saved;
  try { saved = storage?.getItem(STORAGE_KEY); } catch {}
  if (saved && saved !== "osm") void switcher.select(saved);
}
