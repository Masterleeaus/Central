/** In-process fixed-window rate limiter keyed by an arbitrary string (client IP or subject).
 * Limits are per process: they do not coordinate across instances and reset on restart.
 * Production limits MUST also be enforced at the reverse proxy (Apache or nginx on the
 * DirectAdmin host); this is a second line of defence for the application itself.
 * The key map is bounded by maxKeys, so a flood of distinct keys cannot grow memory without limit. */
export function createRateLimiter({ limit, windowMs, maxKeys = 10_000, clock = () => Date.now() } = {}) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000_000) throw new TypeError('invalid rate limit');
  if (!Number.isSafeInteger(windowMs) || windowMs < 1000 || windowMs > 3_600_000) throw new TypeError('invalid rate window');
  if (!Number.isSafeInteger(maxKeys) || maxKeys < 1) throw new TypeError('invalid rate key bound');
  const windows = new Map();
  const evict = (now) => {
    for (const [key, w] of windows) if (now - w.start >= windowMs) windows.delete(key);
    while (windows.size >= maxKeys) windows.delete(windows.keys().next().value);
  };
  return {
    take(key) {
      const now = clock();
      let w = windows.get(key);
      if (!w || now - w.start >= windowMs) {
        if (!w && windows.size >= maxKeys) evict(now);
        w = { start: now, count: 0 };
        windows.set(key, w);
      }
      w.count += 1;
      const allowed = w.count <= limit;
      return { allowed, remaining: Math.max(0, limit - w.count), retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil((w.start + windowMs - now) / 1000)) };
    },
  };
}
