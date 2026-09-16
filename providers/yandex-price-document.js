import { normalizeFuelName } from "../domain/stations.js";

function decodeHtml(value) {
  return value.replaceAll("\\u003c", "<").replaceAll("\\u003e", ">")
    .replaceAll("\\u0026", "&").replaceAll('\\"', '"')
    .replaceAll("&quot;", '"').replaceAll("&nbsp;", " ").replaceAll("&amp;", "&");
}

function plainText(value) {
  return value.replace(/<[^>]*>/g, "").trim();
}

function stateItems(rawHtml) {
  for (const match of rawHtml.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (!/\bclass\s*=\s*["'][^"']*\bstate-view\b/.test(match[1])) continue;
    try {
      const state = JSON.parse(match[2]);
      return { found: true, items: (Array.isArray(state.stack) ? state.stack : [])
        .flatMap((entry) => Array.isArray(entry?.results?.items) ? entry.results.items : []) };
    } catch { return { found: true, items: [], invalid: true }; }
  }
  return { found: false, items: [] };
}

// Read only the requested organization, never a recommendation elsewhere on the page.
export function parseYandexPriceDocument(rawHtml, organizationId = null) {
  const html = decodeHtml(rawHtml);
  const state = stateItems(rawHtml);
  const item = organizationId == null
    ? state.items.find((candidate) => candidate.fuelInfo)
    : state.items.find((candidate) => String(candidate.id) === String(organizationId));
  const closed = item?.status === "permanent-closed";
  const diagnostics = {
    stateFound: state.found, stateInvalid: Boolean(state.invalid),
    cardMatched: Boolean(item), fuelInfoFound: Boolean(item?.fuelInfo),
  };
  const result = { prices: {}, updatedAt: null, status: "unverified", closed, diagnostics };
  if (state.found && organizationId != null && !item) return result;
  const updated = html.match(/Обновлено (?<date>[^<\\]{1,80}) по данным/)?.groups?.date ?? null;
  if (Array.isArray(item?.fuelInfo?.items)) {
    for (const fuel of item.fuelInfo.items) {
      const value = Number(fuel.price?.value);
      if (fuel.name && Number.isFinite(value) && value > 0) {
        result.prices[normalizeFuelName(fuel.name)] = { value, currency: fuel.price.currency || "RUB", source: "yandex" };
      }
    }
    const timestamp = Number(item.fuelInfo.timestamp);
    const date = new Date(timestamp * 1000);
    result.updatedAt = updated || (timestamp > 0 && Number.isFinite(date.getTime()) ? date.toISOString() : null);
    if (Object.keys(result.prices).length) {
      result.status = "available";
      return result;
    }
    // An explicit empty list is different from a missing or unrecognized price block.
    if (!item.fuelInfo.items.length) result.status = "not_published";
    return result;
  }
  if (state.found) return result;
  const pattern = /search-fuel-info-view__name\b[^"']*["'][^>]*>(?<fuel>[\s\S]*?)<\/div>\s*<div\b[^>]*\bclass=["'][^"']*search-fuel-info-view__value\b[^"']*["'][^>]*>(?<price>[\s\S]*?)<\/div>/g;
  let rows = 0;
  let emptyRows = 0;
  for (const match of html.matchAll(pattern)) {
    rows++;
    const priceText = plainText(match.groups.price);
    if (!priceText || /^[–—-]$/.test(priceText)) { emptyRows++; continue; }
    const numberText = priceText.replace(/(?:₽|руб\.?|RUB)/gi, "").replace(/[\s\u00a0]/g, "").replace(",", ".");
    const value = /^\d+(?:\.\d+)?$/.test(numberText) ? Number(numberText) : NaN;
    if (Number.isFinite(value) && value > 0) result.prices[normalizeFuelName(plainText(match.groups.fuel))] = { value, currency: "RUB", source: "yandex" };
  }
  result.updatedAt ||= updated;
  result.diagnostics.htmlPriceRows = rows;
  if (Object.keys(result.prices).length) result.status = "available";
  else if (rows > 0 && rows === emptyRows) result.status = "not_published";
  return result;
}
