export const COLUMN_KEYS = Object.freeze(["name", "sources", "status", "fuel", "price", "fresh"]);

export function normalizeColumnOrder(value) {
  if (!Array.isArray(value) || value.length !== COLUMN_KEYS.length) return [...COLUMN_KEYS];
  const allowed = new Set(COLUMN_KEYS);
  if (new Set(value).size !== COLUMN_KEYS.length || !value.every((key) => allowed.has(key))) return [...COLUMN_KEYS];
  return [...value];
}

export function moveColumnOrder(order, source, target, placeAfter = false) {
  const current = normalizeColumnOrder(order);
  if (!current.includes(source) || !current.includes(target) || source === target) return current;
  const next = current.filter((key) => key !== source);
  const targetIndex = next.indexOf(target);
  next.splice(targetIndex + (placeAfter ? 1 : 0), 0, source);
  return next;
}
