/** Limits forced JWKS refreshes triggered by unknown `kid` values.
 * At most one forced refresh per cooldown window per verifier instance, and a
 * negative cache so the same unknown kid does not trigger repeated lookups.
 * In-process only; the IdP call budget is still bounded per process. */
export function createJwksRefreshGuard({ cooldownMs = 30_000, clock = () => Date.now(), maxNegative = 256 } = {}) {
  if (!Number.isSafeInteger(cooldownMs) || cooldownMs < 1000 || cooldownMs > 300_000) throw new TypeError('invalid JWKS refresh cooldown');
  let lastFetchAt = -Infinity;
  const misses = new Map();
  const prune = (now) => {
    for (const [kid, until] of misses) if (until <= now) misses.delete(kid);
    while (misses.size >= maxNegative) misses.delete(misses.keys().next().value);
  };
  return {
    recordFetch() { lastFetchAt = clock(); },
    /** True when a forced refresh is permitted for this kid right now. */
    mayRefresh(kid) {
      const now = clock();
      const until = misses.get(kid);
      if (until !== undefined && until > now) return false;
      return now - lastFetchAt >= cooldownMs;
    },
    recordMiss(kid) {
      const now = clock();
      if (!misses.has(kid)) prune(now);
      misses.set(kid, now + cooldownMs);
    },
  };
}
