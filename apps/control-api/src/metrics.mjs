/** In-process operational counters, exposed as Prometheus text on GET /metrics.
 * Only fixed metric names and closed label sets exist here. Tenant, subject, identity, token and
 * organisation values are never stored or rendered: decision reasons are accepted only when they
 * look like a reason code, otherwise they are counted as "other". Counters reset on restart. */
const REASON = /^[a-z][a-z_]{0,63}$/;
const LATENCY_BUCKETS_S = Object.freeze([0.05, 0.1, 0.25, 0.5, 1, 2.5, 5]);
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const metricsHeaders = Object.freeze({
  'cache-control': 'no-store',
  'content-type': 'text/plain; version=0.0.4; charset=utf-8',
  'x-content-type-options': 'nosniff',
});

export function createMetrics() {
  const allowed = { count: 0 };
  const denied = new Map();
  const rateLimited = { ip: 0, subject: 0 };
  const logto = { ok: 0, error: 0, latencyCount: 0, latencySum: 0, buckets: LATENCY_BUCKETS_S.map(() => 0) };
  const counts = { unauthenticated: 0, accessErrors: 0, adminProvisionFailed: 0, healthzDbUnavailable: 0, status5xx: 0 };

  return {
    /** Receives the same (event, fields) pairs as the structured log. Unknown events are ignored. */
    observeLog(event, fields = {}) {
      const f = fields ?? {};
      switch (event) {
        case 'access_decision':
          if (f.decision === 'allow') allowed.count++;
          else if (f.decision === 'deny') {
            const reason = typeof f.reason === 'string' && REASON.test(f.reason) ? f.reason : 'other';
            denied.set(reason, (denied.get(reason) ?? 0) + 1);
          }
          break;
        case 'access_rate_limited':
          if (f.scope === 'ip' || f.scope === 'subject') rateLimited[f.scope]++;
          break;
        case 'access_unauthenticated': counts.unauthenticated++; break;
        case 'access_error': counts.accessErrors++; break;
        case 'admin_provision_failed': counts.adminProvisionFailed++; break;
        case 'healthz_database_unavailable': counts.healthzDbUnavailable++; break;
        default: break;
      }
    },
    observeResponse(status) {
      if (Number.isInteger(status) && status >= 500 && status <= 599) counts.status5xx++;
    },
    /** One Logto Management API or token call. Only the outcome and duration are recorded. */
    observeLogto(ok, durationMs) {
      if (ok) logto.ok++; else logto.error++;
      const seconds = Math.max(0, Number(durationMs) || 0) / 1000;
      logto.latencyCount++;
      logto.latencySum += seconds;
      LATENCY_BUCKETS_S.forEach((bound, i) => { if (seconds <= bound) logto.buckets[i]++; });
    },
    render() {
      const out = [];
      const family = (name, type, help) => out.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`);
      const sample = (name, value, labels) => out.push(labels ? `${name}{${labels}} ${value}` : `${name} ${value}`);
      family('titan_access_decisions_total', 'counter', 'Access decisions by outcome and denial reason.');
      sample('titan_access_decisions_total', allowed.count, 'decision="allow"');
      for (const [reason, n] of [...denied.entries()].sort(([a], [b]) => a.localeCompare(b)))
        sample('titan_access_decisions_total', n, `decision="deny",reason="${reason}"`);
      family('titan_rate_limited_total', 'counter', 'Requests refused by the in-process rate limiter, by scope.');
      sample('titan_rate_limited_total', rateLimited.ip, 'scope="ip"');
      sample('titan_rate_limited_total', rateLimited.subject, 'scope="subject"');
      family('titan_access_unauthenticated_total', 'counter', 'Access checks with an invalid or unverifiable bearer token.');
      sample('titan_access_unauthenticated_total', counts.unauthenticated);
      family('titan_access_errors_total', 'counter', 'Access checks that failed inside the service and answered 503.');
      sample('titan_access_errors_total', counts.accessErrors);
      family('titan_http_responses_5xx_total', 'counter', 'Responses with a 5xx status.');
      sample('titan_http_responses_5xx_total', counts.status5xx);
      family('titan_healthz_database_unavailable_total', 'counter', 'Health checks that failed the database query.');
      sample('titan_healthz_database_unavailable_total', counts.healthzDbUnavailable);
      family('titan_admin_provision_failed_total', 'counter', 'Admin provisioning requests that failed after authorisation.');
      sample('titan_admin_provision_failed_total', counts.adminProvisionFailed);
      family('titan_logto_requests_total', 'counter', 'Logto Management API and token requests by result.');
      sample('titan_logto_requests_total', logto.ok, 'result="ok"');
      sample('titan_logto_requests_total', logto.error, 'result="error"');
      family('titan_logto_request_duration_seconds', 'histogram', 'Latency of Logto Management API and token requests.');
      LATENCY_BUCKETS_S.forEach((bound, i) => sample('titan_logto_request_duration_seconds_bucket', logto.buckets[i], `le="${bound}"`));
      sample('titan_logto_request_duration_seconds_bucket', logto.latencyCount, 'le="+Inf"');
      sample('titan_logto_request_duration_seconds_sum', logto.latencySum);
      sample('titan_logto_request_duration_seconds_count', logto.latencyCount);
      return `${out.join('\n')}\n`;
    },
  };
}

/** Wraps a fetch-compatible function so every call is counted and timed. The URL is not recorded. */
export function timedFetch(fetcher, metrics, now = () => performance.now()) {
  return async (url, init) => {
    const started = now();
    let ok = false;
    try {
      const response = await fetcher(url, init);
      ok = Boolean(response?.ok);
      return response;
    } finally {
      metrics.observeLogto(ok, now() - started);
    }
  };
}

/** GET /metrics. Answers 404 to any non-loopback socket, as a second guard behind the 127.0.0.1 bind. */
export function serveMetrics(req, res, metrics) {
  if (!LOOPBACK.has(req.socket?.remoteAddress)) {
    res.writeHead(404, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ error: 'not_found' }));
    return;
  }
  res.writeHead(200, metricsHeaders);
  res.end(metrics.render());
}

export function pathnameOf(req) {
  try { return new URL(req.url ?? '/', 'http://localhost').pathname; } catch { return undefined; }
}
