export function readFreshCache(cache, key, ttlMs, now = Date.now()) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (now - entry.createdAt >= ttlMs) {
    cache.delete(key);
    return null;
  }
  cache.delete(key);
  cache.set(key, entry);
  return entry.value;
}

export function writeBoundedCache(cache, key, value, maxEntries, createdAt = Date.now()) {
  cache.delete(key);
  cache.set(key, { createdAt, value });
  while (cache.size > maxEntries) {
    cache.delete(cache.keys().next().value);
  }
}
