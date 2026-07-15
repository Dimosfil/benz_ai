import {
  fuelName,
  labels,
  minimumPrice,
  selectionStatus,
  sourceNames,
  stationFreshText,
  stationFuelText,
  stationPriceText,
  stationSources,
} from "./station-view.js";
import { COLUMN_KEYS, moveColumnOrder, normalizeColumnOrder } from "./table-order.js";
import { filterStations, normalizeSelectedFuels } from "./station-filter.js";
import { fetchJson } from "./api-client.js";
import { createStationMap } from "./station-map.js";

const locationInput = document.querySelector("#location");
const fuel = document.querySelector("#fuel");
const fuelAny = document.querySelector("#fuel-any");
const fuelInputs = [...fuel.querySelectorAll('input[type="checkbox"]:not(#fuel-any)')];
const status = document.querySelector("#status");
const statusAny = document.querySelector("#status-any");
const statusInputs = [...status.querySelectorAll('input[type="checkbox"]:not(#status-any)')];
const query = document.querySelector("#query");
const results = document.querySelector("#results");
const stationRows = document.querySelector("#station-rows");
const pageSizeSelect = document.querySelector("#page-size");
const pagePrev = document.querySelector("#page-prev");
const pageNext = document.querySelector("#page-next");
const pageNumber = document.querySelector("#page-number");
const pageSummary = document.querySelector("#page-summary");
const tableWrap = document.querySelector(".table-wrap");
const tableResetSize = document.querySelector("#table-reset-size");
const tableHeaderRow = document.querySelector(".station-table thead tr");
const notice = document.querySelector("#notice");
const count = document.querySelector("#count");
const meta = document.querySelector("#meta");
const template = document.querySelector("#station");
const overview = document.querySelector("#overview");
const summaryDetails = document.querySelector("#summary-details");
const statusLegend = document.querySelector("#status-legend");
const findButton = document.querySelector("#find");
const refreshButton = document.querySelector("#refresh-cache");
const buildInfoNode = document.querySelector("#build-info");
const mapSection = document.querySelector("#map-section");
const mapTab = document.querySelector("#map-tab");
const tableTab = document.querySelector("#table-tab");
const mapPanel = document.querySelector("#map-panel");
const tablePanel = document.querySelector("#table-panel");
const stationMap = createStationMap({
  container: document.querySelector("#station-map"),
  message: document.querySelector("#map-message"),
  count: document.querySelector("#map-count"),
});
let allStations = [];
let initialSummaryLoad = true;
let currentPage = 1;
let pageSize = Number(pageSizeSelect.value);
let sortKey = "name";
let sortDirection = 1;
let pendingTableScroll = null;
let saveTimer = null;
let lastTableSize = null;
let draggedColumn = null;
let activeTab = "map";
let pendingMapFocus = null;

const UI_STATE_KEY = "benz-ai.ui.v1";
const sortKeys = new Set(COLUMN_KEYS);
let columnOrder = [...COLUMN_KEYS];
const headersByColumn = new Map([...tableHeaderRow.children].map((header) => [header.dataset.key, header]));

function saveUIState() {
  clearTimeout(saveTimer);
  saveTimer = null;
  try {
    const bounds = tableWrap.getBoundingClientRect();
    if (bounds.width >= 480 && bounds.height >= 240) {
      lastTableSize = { width: Math.round(bounds.width), height: Math.round(bounds.height) };
    }
    localStorage.setItem(UI_STATE_KEY, JSON.stringify({
      location: locationInput.value,
      query: query.value,
      fuels: selectedFuels(),
      statuses: selectedStatuses(),
      pageSize,
      currentPage,
      sortKey,
      sortDirection,
      columnOrder,
      fuelOpen: fuel.open,
      statusOpen: status.open,
      activeTab,
      table: {
        ...lastTableSize,
        scrollLeft: Math.round(tableWrap.scrollLeft),
        scrollTop: Math.round(tableWrap.scrollTop),
      },
    }));
  } catch {}
}

function scheduleSaveUIState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveUIState, 120);
}

function restoreUIState() {
  let saved;
  try { saved = JSON.parse(localStorage.getItem(UI_STATE_KEY)); } catch {}
  if (!saved || typeof saved !== "object") return;
  if (typeof saved.location === "string" && saved.location.trim()) locationInput.value = saved.location;
  if (typeof saved.query === "string") query.value = saved.query;
  if (Array.isArray(saved.fuels)) {
    fuelInputs.forEach((input) => { input.checked = saved.fuels.includes(input.value); });
    fuelAny.checked = saved.fuels.length === 0;
  }
  if (Array.isArray(saved.statuses)) {
    statusInputs.forEach((input) => { input.checked = saved.statuses.includes(input.value); });
    statusAny.checked = saved.statuses.length === 0;
  }
  if ([10, 25, 50, 100].includes(Number(saved.pageSize))) {
    pageSize = Number(saved.pageSize);
    pageSizeSelect.value = String(pageSize);
  }
  if (Number.isInteger(saved.currentPage) && saved.currentPage > 0) currentPage = saved.currentPage;
  if (sortKeys.has(saved.sortKey)) sortKey = saved.sortKey;
  sortDirection = saved.sortDirection === -1 ? -1 : 1;
  columnOrder = normalizeColumnOrder(saved.columnOrder);
  fuel.open = Boolean(saved.fuelOpen);
  status.open = Boolean(saved.statusOpen);
  activeTab = saved.activeTab === "table" ? "table" : "map";
  if (saved.table && typeof saved.table === "object") {
    lastTableSize = {
      width: Number(saved.table.width) || null,
      height: Number(saved.table.height) || null,
    };
    const maxWidth = Math.max(480, window.innerWidth - tableWrap.getBoundingClientRect().left - 16);
    if (Number(saved.table.width) >= 480) tableWrap.style.width = `${Math.min(Number(saved.table.width), maxWidth)}px`;
    if (Number(saved.table.height) >= 240) tableWrap.style.height = `${Math.min(Number(saved.table.height), window.innerHeight * 0.85)}px`;
    pendingTableScroll = {
      left: Math.max(0, Number(saved.table.scrollLeft) || 0),
      top: Math.max(0, Number(saved.table.scrollTop) || 0),
    };
  }
}

function setActiveTab(tabName, { focusTab = false } = {}) {
  activeTab = tabName === "table" ? "table" : "map";
  const mapActive = activeTab === "map";
  mapPanel.hidden = !mapActive;
  tablePanel.hidden = mapActive;
  mapTab.setAttribute("aria-selected", String(mapActive));
  tableTab.setAttribute("aria-selected", String(!mapActive));
  mapTab.tabIndex = mapActive ? 0 : -1;
  tableTab.tabIndex = mapActive ? -1 : 0;
  if (focusTab) (mapActive ? mapTab : tableTab).focus();
  if (mapActive) requestAnimationFrame(() => {
    stationMap.resize();
    if (pendingMapFocus) {
      stationMap.focusStations(pendingMapFocus);
      pendingMapFocus = null;
    }
  });
  scheduleSaveUIState();
}

function applyColumnOrder() {
  tableHeaderRow.replaceChildren(...columnOrder.map((key) => headersByColumn.get(key)));
}

function selectedFuels() {
  return normalizeSelectedFuels(
    fuelInputs.filter((input) => input.checked).map((input) => input.value),
    fuelInputs.map((input) => input.value),
  );
}

function updateFuelPicker(changed) {
  if (changed === fuelAny && fuelAny.checked) fuelInputs.forEach((input) => { input.checked = false; });
  if (changed !== fuelAny && changed?.checked) fuelAny.checked = false;
  // Selecting every known fuel must mean the same as "Any". Otherwise stations
  // that have no per-fuel data disappear even though the user selected all types.
  if (fuelInputs.every((input) => input.checked)) {
    fuelInputs.forEach((input) => { input.checked = false; });
    fuelAny.checked = true;
  }
  if (!fuelInputs.some((input) => input.checked)) fuelAny.checked = true;
  const selected = selectedFuels();
  document.querySelector("#fuel-label").textContent = selected.length ? selected.map(fuelName).join(", ") : "Любое";
}

function selectedStatuses() {
  return statusInputs.filter((input) => input.checked).map((input) => input.value);
}

function updateStatusPicker(changed) {
  if (changed === statusAny && statusAny.checked) statusInputs.forEach((input) => { input.checked = false; });
  if (changed !== statusAny && changed?.checked) statusAny.checked = false;
  if (!statusInputs.some((input) => input.checked)) statusAny.checked = true;
  const selected = selectedStatuses();
  document.querySelector("#status-label").textContent = selected.length ? selected.map((value) => labels[value]).join(", ") : "Все статусы";
}

function badge(statusValue) {
  const value = statusValue || "no_data";
  const element = document.createElement("span");
  element.className = `badge ${value}`;
  element.textContent = labels[value] || "Нет данных";
  return element;
}

function sortValue(station, key, selectedFuel) {
  if (key === "name") return `${station.name} ${station.address}`;
  if (key === "sources") return stationSources(station);
  if (key === "status") return ({ available: 1, maybe_available: 2, no_data: 3, not_available: 4 })[selectionStatus(station, selectedFuel)] || 5;
  if (key === "fuel") return stationFuelText(station, selectedFuel);
  if (key === "price") return minimumPrice(station);
  if (key === "fresh") return station.lastTransactionAt ? Date.parse(station.lastTransactionAt) : null;
  return "";
}

function sortStations(stations, selectedFuel) {
  return [...stations].sort((left, right) => {
    const a = sortValue(left, sortKey, selectedFuel);
    const b = sortValue(right, sortKey, selectedFuel);
    if (a == null && b == null) return 0;
    if (a == null) return 1;
    if (b == null) return -1;
    if (typeof a === "number" && typeof b === "number") return (a - b) * sortDirection;
    return String(a).localeCompare(String(b), "ru", { numeric: true, sensitivity: "base" }) * sortDirection;
  });
}

function updateSortUI() {
  document.querySelectorAll(".station-table th[data-key]").forEach((header) => {
    const active = header.dataset.key === sortKey;
    header.setAttribute("aria-sort", active ? (sortDirection === 1 ? "ascending" : "descending") : "none");
    header.querySelector("span").textContent = active ? (sortDirection === 1 ? "↑" : "↓") : "↕";
  });
}

function metric(value, label) {
  const card = document.createElement("div");
  card.className = "metric";
  const strong = document.createElement("strong");
  const span = document.createElement("span");
  strong.textContent = value;
  span.textContent = label;
  card.append(strong, span);
  return card;
}

function renderSummary(data) {
  overview.hidden = false;
  summaryDetails.hidden = false;
  statusLegend.hidden = false;
  document.querySelector("#place-name").textContent = data.location.name;
  document.querySelector("#place-meta").textContent = data.location.displayName;
  const summary = data.summary;
  document.querySelector("#summary-cards").replaceChildren(
    metric(summary.total, "АЗС найдено"),
    metric(summary.statuses.available, "вероятно есть топливо"),
    metric(summary.statuses.maybe_available, "возможно есть"),
    metric(summary.withPrices, "АЗС с ценами"),
  );
  const sourceStatus = Object.entries(data.sources || {}).map(([name, state]) => {
    const item = document.createElement("span");
    item.className = `source-chip ${state.available ? "is-active" : "is-inactive"}`;
    const refresh = state.refreshSeconds ? ` · каждые ${state.refreshSeconds} с` : "";
    item.textContent = `${sourceNames[name] || name}: ${state.available ? "работает" : state.configured ? "недоступен" : "не подключён"}${refresh}`;
    item.title = [state.refreshedAt && `Обновлено: ${state.refreshedAt}`, state.error].filter(Boolean).join("\n");
    return item;
  });
  document.querySelector("#source-status").replaceChildren(...sourceStatus);
  const fuelRows = Object.entries(summary.fuels).sort(([a], [b]) => a.localeCompare(b, "ru", { numeric: true })).map(([type, values]) => {
    const row = document.createElement("div");
    row.className = "fuel-row";
    const name = document.createElement("strong");
    const details = document.createElement("span");
    name.textContent = fuelName(type);
    details.textContent = `${values.available} есть · ${values.maybe_available} возможно · ${values.not_available} нет · ${values.no_data} без данных`;
    row.append(name, details);
    return row;
  });
  document.querySelector("#fuel-summary").replaceChildren(...fuelRows);
  document.querySelector("#attribution").textContent = `Геокодирование: ${data.location.attribution}. Доступность топлива носит вероятностный характер.`;
  renderBuildInfo(data.build);
}

function renderBuildInfo(build) {
  const software = build?.version && build.version !== "unknown" ? `ПО ${build.version}` : "";
  const knownCommit = build?.shortCommit && build.shortCommit !== "unknown" ? build.shortCommit : "";
  if (!software && !knownCommit) {
    buildInfoNode.textContent = "Версия неизвестна";
    return;
  }
  const parsed = build.committedAt ? new Date(build.committedAt) : null;
  const date = parsed && Number.isFinite(parsed.getTime())
    ? new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(parsed)
    : "дата неизвестна";
  const parts = [software, knownCommit, knownCommit ? `коммит ${date}` : ""].filter(Boolean);
  buildInfoNode.textContent = `Версия ${parts.join(" · ")}`;
  buildInfoNode.title = knownCommit ? build.commit : "";
}

function renderStations() {
  const selectedFuel = selectedFuels();
  const selectedStatus = selectedStatuses();
  const filtered = filterStations(allStations, { fuels: selectedFuel, statuses: selectedStatus, text: query.value });
  const sorted = sortStations(filtered, selectedFuel);
  stationMap.setFilters({ fuels: selectedFuel, statuses: selectedStatus, text: query.value });
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  currentPage = Math.min(currentPage, totalPages);
  const firstIndex = (currentPage - 1) * pageSize;
  const visible = sorted.slice(firstIndex, firstIndex + pageSize);
  count.textContent = filtered.length;
  meta.textContent = `из ${allStations.length} АЗС · страница ${currentPage} из ${totalPages}`;
  pageSummary.textContent = filtered.length ? `Показаны ${firstIndex + 1}–${firstIndex + visible.length} из ${filtered.length}` : "По выбранным фильтрам ничего не найдено";
  pageNumber.textContent = `${currentPage} / ${totalPages}`;
  pagePrev.disabled = currentPage <= 1;
  pageNext.disabled = currentPage >= totalPages;
  const rows = visible.map((station) => {
    const row = document.createElement("tr");
    const stationCell = document.createElement("td");
    const name = document.createElement("strong");
    const address = document.createElement("small");
    name.textContent = station.name;
    address.textContent = station.address;
    stationCell.append(name, address);
    const sourcesCell = document.createElement("td");
    sourcesCell.textContent = stationSources(station);
    const statusCell = document.createElement("td");
    statusCell.append(badge(selectionStatus(station, selectedFuel)));
    const fuelCell = document.createElement("td");
    fuelCell.textContent = stationFuelText(station, selectedFuel);
    const priceCell = document.createElement("td");
    priceCell.textContent = stationPriceText(station);
    const freshCell = document.createElement("td");
    freshCell.textContent = stationFreshText(station);
    const cells = { name: stationCell, sources: sourcesCell, status: statusCell, fuel: fuelCell, price: priceCell, fresh: freshCell };
    row.append(...columnOrder.map((key) => cells[key]));
    return row;
  });
  if (!rows.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 6;
    cell.className = "empty-row";
    cell.textContent = "Нет АЗС, соответствующих выбранным фильтрам";
    row.append(cell);
    rows.push(row);
  }
  stationRows.replaceChildren(...rows);
  updateSortUI();
  results.replaceChildren(...visible.map((station) => {
    const node = template.content.cloneNode(true);
    const actualStatus = selectionStatus(station, selectedFuel);
    node.querySelector(".source").textContent = stationSources(station);
    node.querySelector("h2").textContent = station.name;
    node.querySelector(".address").textContent = station.address;
    const badgeElement = node.querySelector(".badge");
    badgeElement.replaceWith(badge(actualStatus));
    node.querySelector(".fuel").textContent = stationFuelText(station, selectedFuel);
    node.querySelector(".prices").textContent = stationPriceText(station);
    node.querySelector(".detail").textContent = station.detail || "";
    const link = node.querySelector(".station-link");
    const mapLink = station.links?.yandex || station.links?.twoGis;
    if (mapLink) { link.href = mapLink; link.hidden = false; }
    node.querySelector(".fresh").textContent = stationFreshText(station);
    return node;
  }));
  if (pendingTableScroll) {
    requestAnimationFrame(() => {
      tableWrap.scrollTo(pendingTableScroll);
      pendingTableScroll = null;
      scheduleSaveUIState();
    });
  } else {
    scheduleSaveUIState();
  }
}

function filteredStations() {
  return filterStations(allStations, {
    fuels: selectedFuels(),
    statuses: selectedStatuses(),
    text: query.value,
  });
}

async function loadSummary({ refresh = false, activateMap = false } = {}) {
  const protectUserLocation = initialSummaryLoad;
  initialSummaryLoad = false;
  findButton.disabled = true;
  refreshButton.disabled = true;
  meta.textContent = refresh ? "Очищаем кэш и заново опрашиваем источники…" : "Определяем территорию и собираем АЗС…";
  notice.hidden = true;
  try {
    const path = refresh ? "/api/cache/refresh" : "/api/summary";
    const data = await fetchJson(`${path}?q=${encodeURIComponent(locationInput.value.trim())}`, { method: refresh ? "POST" : "GET" });
    allStations = data.stations;
    if (activateMap) setActiveTab("map");
    mapSection.hidden = false;
    renderSummary(data);
    renderStations();
    const matches = filteredStations();
    const mapFocus = matches.length ? matches : allStations;
    if (mapPanel.hidden) pendingMapFocus = mapFocus;
    stationMap.showStations(allStations, {
      fit: !mapPanel.hidden,
      protectUserLocation,
      focus: mapFocus,
    });
    const messages = [...(data.warnings || [])];
    if (data.cacheRefresh?.refreshed) messages.unshift(`Весь кэш обновлён за ${(data.cacheRefresh.durationMs / 1000).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} с.`);
    notice.hidden = !messages.length;
    notice.textContent = messages.join(" ");
  } catch (error) {
    allStations = [];
    overview.hidden = true;
    summaryDetails.hidden = true;
    statusLegend.hidden = true;
    renderStations();
    notice.hidden = false;
    notice.textContent = error instanceof Error ? error.message : "Не удалось получить сводку.";
    count.textContent = "—";
    meta.textContent = "Сводка не получена";
  } finally {
    findButton.disabled = false;
    refreshButton.disabled = false;
  }
}

async function search(event) {
  event?.preventDefault();
  currentPage = 1;
  scheduleSaveUIState();
  await loadSummary({ activateMap: true });
}

document.querySelector("#search-form").addEventListener("submit", search);
mapTab.addEventListener("click", () => setActiveTab("map"));
tableTab.addEventListener("click", () => setActiveTab("table"));
[mapTab, tableTab].forEach((tab) => tab.addEventListener("keydown", (event) => {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const next = event.key === "ArrowLeft" || event.key === "Home" ? "map" : "table";
  setActiveTab(next, { focusTab: true });
}));
refreshButton.addEventListener("click", () => loadSummary({ refresh: true }));
fuel.addEventListener("change", (event) => { updateFuelPicker(event.target); currentPage = 1; renderStations(); });
status.addEventListener("change", (event) => { updateStatusPicker(event.target); currentPage = 1; renderStations(); });
query.addEventListener("input", () => { currentPage = 1; renderStations(); });
locationInput.addEventListener("input", scheduleSaveUIState);
pageSizeSelect.addEventListener("change", () => { pageSize = Number(pageSizeSelect.value); currentPage = 1; renderStations(); });
pagePrev.addEventListener("click", () => { if (currentPage > 1) { currentPage -= 1; renderStations(); tableWrap.scrollTop = 0; } });
pageNext.addEventListener("click", () => { currentPage += 1; renderStations(); tableWrap.scrollTop = 0; });
document.querySelectorAll(".sort-button").forEach((button) => button.addEventListener("click", () => {
  const key = button.closest("th").dataset.key;
  if (sortKey === key) sortDirection *= -1;
  else { sortKey = key; sortDirection = 1; }
  currentPage = 1;
  renderStations();
}));
headersByColumn.forEach((header) => {
  header.draggable = true;
  header.title = "Перетащите заголовок, чтобы изменить порядок столбцов";
  header.addEventListener("dragstart", (event) => {
    draggedColumn = header.dataset.key;
    header.classList.add("is-dragging");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", draggedColumn);
  });
  header.addEventListener("dragover", (event) => {
    if (!draggedColumn || draggedColumn === header.dataset.key) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    header.classList.add("is-drop-target");
  });
  header.addEventListener("dragleave", () => header.classList.remove("is-drop-target"));
  header.addEventListener("drop", (event) => {
    event.preventDefault();
    const bounds = header.getBoundingClientRect();
    columnOrder = moveColumnOrder(columnOrder, draggedColumn, header.dataset.key, event.clientX > bounds.left + bounds.width / 2);
    applyColumnOrder();
    renderStations();
    header.classList.remove("is-drop-target");
  });
  header.addEventListener("dragend", () => {
    draggedColumn = null;
    headersByColumn.forEach((item) => item.classList.remove("is-dragging", "is-drop-target"));
  });
});
tableResetSize.addEventListener("click", () => {
  tableWrap.style.removeProperty("width");
  tableWrap.style.removeProperty("height");
  scheduleSaveUIState();
});
tableWrap.addEventListener("scroll", scheduleSaveUIState, { passive: true });
fuel.addEventListener("toggle", scheduleSaveUIState);
status.addEventListener("toggle", scheduleSaveUIState);
window.addEventListener("pagehide", saveUIState);
restoreUIState();
setActiveTab(activeTab);
applyColumnOrder();
updateFuelPicker();
updateStatusPicker();
new ResizeObserver(scheduleSaveUIState).observe(tableWrap);
fetchJson("/api/health").then((data) => renderBuildInfo(data.build)).catch(() => renderBuildInfo(null));
mapSection.hidden = false;
stationMap.locateUser();
loadSummary();
