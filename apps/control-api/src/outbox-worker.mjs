/** Outbox worker: runs the publisher loop as its own process.
 *
 * Configuration is read from environment variables at startup. Settings name variables; secrets are never in
 * the environment-variable VALUES of this file, never in logs, and never in error messages. A route refers to its
 * HMAC secret by the NAME of an environment variable (secretEnv) that holds it.
 *
 * Required:  TITAN_OUTBOX_DATABASE_URL   connection string for the publisher role (titan_trusted_writer)
 *            TITAN_OUTBOX_ROUTES         JSON array of consumer routes (no secret values inside)
 * Optional:  TITAN_OUTBOX_POLL_INTERVAL_MS (1000), TITAN_OUTBOX_BATCH_SIZE (20), TITAN_OUTBOX_MAX_ATTEMPTS (8),
 *            TITAN_OUTBOX_REQUEST_TIMEOUT_MS (10000), TITAN_OUTBOX_SHUTDOWN_TIMEOUT_MS (30000),
 *            TITAN_ALLOW_INSECURE_LOCALHOST (set to 1 only for development; allows http://localhost consumers)
 *
 * Logs are JSON lines with an event name and counts. They never carry payloads, signatures, secrets, URLs or
 * database connection strings. Error logs carry the error code only. */
import { pathToFileURL } from 'node:url';
import { createPublisher, createHttpPublishTransport, assertTenantId, resolveRouteKeys } from '../../../packages/control-plane/dist/index.js';
import { insecureLocalhostAllowed } from './endpoint-policy.mjs';

const ENV_NAME = /^[A-Z][A-Z0-9_]{2,127}$/;
const UUID_LIKE = /^[0-9a-fA-F-]{36}$/;
const ROUTE_KEYS_MAX = 2;
const DEFAULTS = { pollIntervalMs: 1000, batchSize: 20, maxAttempts: 8, requestTimeoutMs: 10000, shutdownTimeoutMs: 30000 };
const LIMITS = {
  pollIntervalMs: [100, 60000], batchSize: [1, 500], maxAttempts: [1, 50], requestTimeoutMs: [1, 60000], shutdownTimeoutMs: [1000, 120000],
};
const ENV_FOR = {
  pollIntervalMs: 'TITAN_OUTBOX_POLL_INTERVAL_MS', batchSize: 'TITAN_OUTBOX_BATCH_SIZE', maxAttempts: 'TITAN_OUTBOX_MAX_ATTEMPTS',
  requestTimeoutMs: 'TITAN_OUTBOX_REQUEST_TIMEOUT_MS', shutdownTimeoutMs: 'TITAN_OUTBOX_SHUTDOWN_TIMEOUT_MS',
};
const present = (v) => v !== undefined && v !== '';

function intSetting(env, key) {
  const name = ENV_FOR[key];
  if (!present(env[name])) return DEFAULTS[key];
  const value = Number(env[name]);
  const [min, max] = LIMITS[key];
  if (!/^\d+$/.test(env[name]) || !Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer from ${min} to ${max}`);
  return value;
}

/** Parses TITAN_OUTBOX_ROUTES and resolves each route's secrets from the environment. Throws naming variables only. */
export function readRouteConfig(env) {
  if (!present(env.TITAN_OUTBOX_ROUTES)) throw new Error('TITAN_OUTBOX_ROUTES must be set');
  let raw;
  try { raw = JSON.parse(env.TITAN_OUTBOX_ROUTES); } catch { throw new Error('TITAN_OUTBOX_ROUTES is not valid JSON'); }
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 100) throw new Error('TITAN_OUTBOX_ROUTES must be a JSON array of 1 to 100 routes');
  const seen = new Set();
  return raw.map((route, index) => {
    const label = `TITAN_OUTBOX_ROUTES[${index}]`;
    if (!route || typeof route !== 'object') throw new Error(`${label} must be an object`);
    if (typeof route.consumer !== 'string' || !/^[a-z][a-z0-9_-]{0,127}$/.test(route.consumer)) throw new Error(`${label}.consumer is invalid`);
    if (typeof route.organisationId !== 'string' || !UUID_LIKE.test(route.organisationId)) throw new Error(`${label}.organisationId must be a UUID`);
    const organisationId = assertTenantId(route.organisationId);
    if (!Array.isArray(route.eventTypes) || route.eventTypes.length < 1 || !route.eventTypes.every((t) => typeof t === 'string')) {
      throw new Error(`${label}.eventTypes must be a non-empty array of names`);
    }
    if (typeof route.url !== 'string') throw new Error(`${label}.url is required`);
    const secretRef = (name, field) => {
      if (typeof name !== 'string' || !ENV_NAME.test(name)) throw new Error(`${label}.${field} must name an environment variable`);
      const value = env[name];
      if (!present(value)) throw new Error(`${name} (named by ${label}) is not set`);
      return value;
    };
    const hasSecret = route.secretEnv !== undefined;
    const hasKeys = route.keys !== undefined;
    if (hasSecret === hasKeys) throw new Error(`${label} must set exactly one of secretEnv or keys`);
    if (seen.has(organisationId + '|' + route.consumer)) throw new Error(`${label} repeats a consumer for one tenant`);
    seen.add(organisationId + '|' + route.consumer);
    const base = { consumer: route.consumer, organisationId, eventTypes: route.eventTypes, url: route.url };
    // resolveRouteKeys checks secret length, key windows and overlap now, at startup. Its messages name fields only.
    if (hasSecret) {
      const secret = secretRef(route.secretEnv, 'secretEnv');
      resolveRouteKeys({ consumer: route.consumer, secret });
      return { ...base, secret };
    }
    if (!Array.isArray(route.keys) || route.keys.length < 1 || route.keys.length > ROUTE_KEYS_MAX) throw new Error(`${label}.keys must have 1 to ${ROUTE_KEYS_MAX} entries`);
    const keys = route.keys.map((key, k) => {
      if (!key || typeof key !== 'object') throw new Error(`${label}.keys[${k}] must be an object`);
      return { id: key.id, secret: secretRef(key.secretEnv, `keys[${k}].secretEnv`), notBefore: key.notBefore, notAfter: key.notAfter };
    });
    resolveRouteKeys({ consumer: route.consumer, keys });
    return { ...base, keys };
  });
}

/** Validates the whole worker configuration. Returns plain values; never logs them. */
export function readOutboxWorkerConfig(env = process.env) {
  if (!present(env.TITAN_OUTBOX_DATABASE_URL)) throw new Error('TITAN_OUTBOX_DATABASE_URL must be set');
  const settings = Object.fromEntries(Object.keys(DEFAULTS).map((key) => [key, intSetting(env, key)]));
  const allowInsecureLocalhost = insecureLocalhostAllowed(env);
  const routes = readRouteConfig(env);
  // Refuses an insecure endpoint now, at startup, rather than on the first event.
  createHttpPublishTransport({ endpoints: routes.map((r) => ({ consumer: r.consumer, url: r.url })), allowInsecureLocalhost, timeoutMs: settings.requestTimeoutMs });
  return { databaseUrl: env.TITAN_OUTBOX_DATABASE_URL, routes, allowInsecureLocalhost, ...settings };
}

/** Runs publisher cycles until the signal aborts. A cycle that claims nothing waits pollIntervalMs. A failing cycle
 * waits longer each time (capped), and never stops the loop. The sleep is interruptible by the signal. */
export async function runOutboxLoop({ publisher, pollIntervalMs, signal, log = () => {}, sleep = interruptibleSleep }) {
  let consecutiveFailures = 0;
  const totals = { cycles: 0, claimed: 0, published: 0, failed: 0, dead: 0, cycleErrors: 0 };
  while (!signal.aborted) {
    try {
      const report = await publisher.runOnce();
      consecutiveFailures = 0;
      totals.cycles += 1;
      totals.claimed += report.claimed;
      totals.published += report.published;
      totals.failed += report.failed;
      totals.dead += report.dead;
      if (report.claimed > 0) log('outbox.batch', { claimed: report.claimed, published: report.published, failed: report.failed, dead: report.dead });
      if (report.claimed === 0) await sleep(pollIntervalMs, signal);
    } catch (error) {
      consecutiveFailures += 1;
      totals.cycleErrors += 1;
      // Only the error code is logged. Messages can carry connection details.
      log('outbox.cycle_error', { code: String(error?.code ?? error?.name ?? 'error'), consecutiveFailures });
      await sleep(Math.min(60000, pollIntervalMs * 2 ** Math.min(consecutiveFailures, 6)), signal);
    }
  }
  return totals;
}

export function interruptibleSleep(ms, signal) {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); }
    signal.addEventListener('abort', done, { once: true });
  });
}

/** Builds the publisher from configuration. loadPg and fetch are injectable for tests. */
export async function buildOutboxWorker({ env = process.env, loadPg = () => import('pg'), fetch: fetchImpl, log = () => {} } = {}) {
  const config = readOutboxWorkerConfig(env);
  const { Pool } = await loadPg();
  const pool = new Pool({ connectionString: config.databaseUrl, max: 2, connectionTimeoutMillis: 3000, idleTimeoutMillis: 10000, application_name: 'titan-outbox-worker' });
  const transport = createHttpPublishTransport({
    endpoints: config.routes.map((r) => ({ consumer: r.consumer, url: r.url })),
    fetch: fetchImpl,
    timeoutMs: config.requestTimeoutMs,
    allowInsecureLocalhost: config.allowInsecureLocalhost,
  });
  const publisher = createPublisher({
    pool,
    transport,
    routes: config.routes.map(({ consumer, organisationId, eventTypes, secret, keys }) => (
      secret !== undefined ? { consumer, organisationId, eventTypes, secret } : { consumer, organisationId, eventTypes, keys }
    )),
    maxAttempts: config.maxAttempts,
    batchSize: config.batchSize,
    actor: 'outbox-worker',
  });
  log('outbox.started', { routes: config.routes.length, batchSize: config.batchSize, maxAttempts: config.maxAttempts });
  return { publisher, pool, config };
}

/** Runs the worker until SIGTERM or SIGINT. The in-flight batch finishes, or the shutdown deadline passes first.
 * Then the pool closes. Returns the exit code instead of exiting, so tests can check it. */
export async function runOutboxWorker({ env = process.env, loadPg, fetch: fetchImpl, log = defaultLog, proc = process, sleep } = {}) {
  const built = await buildOutboxWorker({ env, loadPg, fetch: fetchImpl, log });
  const controller = new AbortController();
  const loop = runOutboxLoop({ publisher: built.publisher, pollIntervalMs: built.config.pollIntervalMs, signal: controller.signal, log, sleep });
  const onSignal = (name) => {
    if (controller.signal.aborted) return;
    log('outbox.stopping', { signal: name });
    controller.abort();
  };
  const onTerm = () => onSignal('SIGTERM');
  const onInt = () => onSignal('SIGINT');
  proc.once('SIGTERM', onTerm);
  proc.once('SIGINT', onInt);
  let exitCode = 0;
  let timedOut = false;
  try {
    const outcome = await new Promise((resolve) => {
      let deadline;
      loop.then((totals) => { clearTimeout(deadline); resolve({ totals }); }, (error) => { clearTimeout(deadline); resolve({ error }); });
      controller.signal.addEventListener('abort', () => {
        deadline = setTimeout(() => resolve({ timedOut: true }), built.config.shutdownTimeoutMs);
      }, { once: true });
    });
    if (outcome.timedOut) {
      timedOut = true;
      log('outbox.shutdown_timeout', { shutdownTimeoutMs: built.config.shutdownTimeoutMs });
      exitCode = 1;
    } else if (outcome.error) {
      log('outbox.loop_failed', { code: String(outcome.error?.code ?? outcome.error?.name ?? 'error') });
      exitCode = 1;
    } else {
      log('outbox.stopped', { cycles: outcome.totals.cycles, published: outcome.totals.published, failed: outcome.totals.failed, dead: outcome.totals.dead });
    }
  } finally {
    proc.removeListener('SIGTERM', onTerm);
    proc.removeListener('SIGINT', onInt);
    if (timedOut) {
      // A query may still be in flight. Do not wait for it: the process is exiting.
      built.pool.end().catch(() => {});
    } else {
      try { await built.pool.end(); } catch { exitCode = 1; }
    }
  }
  return exitCode;
}

function defaultLog(event, fields = {}) {
  process.stdout.write(JSON.stringify({ ts: new Date().toISOString(), event, ...fields }) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runOutboxWorker().then((code) => { process.exitCode = code; }, (error) => {
    // Configuration errors name variables, never values. Other errors log their code only.
    process.stderr.write(JSON.stringify({ ts: new Date().toISOString(), event: 'outbox.start_failed', message: String(error?.message ?? 'error').slice(0, 300) }) + '\n');
    process.exitCode = 1;
  });
}
