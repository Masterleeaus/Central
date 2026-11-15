/** Scheduled operator settings (default off). Read at startup from operator configuration, never from a request.
 * Unset or empty means Scheduled is not configured and nothing is checked. Names only in errors, never values.
 *   TITAN_SCHEDULED_ORIGIN    HTTPS origin of the Scheduled service (no path, query, userinfo or port).
 *                             When set, the same origin must also appear in TITAN_PRODUCT_TRUSTED_ORIGINS.
 *   TITAN_SCHEDULED_AUDIENCE  Logto audience for Scheduled tokens. One audience per app (ADR-005), so it must
 *                             differ from the Sorted, Supercharged and LMS audiences and from the link audience.
 */
export const SCHEDULED_ORIGIN_VAR = 'TITAN_SCHEDULED_ORIGIN';
export const SCHEDULED_AUDIENCE_VAR = 'TITAN_SCHEDULED_AUDIENCE';
const TRUSTED_VAR = 'TITAN_PRODUCT_TRUSTED_ORIGINS';
const PEER_AUDIENCE_VARS = ['TITAN_FIELD_AUDIENCE', 'TITAN_DESK_AUDIENCE', 'TITAN_ACADEMY_AUDIENCE'];
const LINK_AUDIENCE = 'titan-central';
const PLACEHOLDER = 'REPLACE_ME';
const present = v => v !== undefined && v !== '';

function httpsOrigin(name, value) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`${name} must be an HTTPS origin`); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error(`${name} must be an HTTPS origin with no credentials, query or fragment`);
  }
  if (url.pathname !== '/' || url.port !== '' || value !== url.origin) throw new Error(`${name} must be an origin with no path or port`);
  return url.origin;
}

/** Returns { origin, audience } for the configured values, or null when Scheduled is not configured. Throws on any invalid value. */
export function readScheduledSettings(env) {
  const originSet = present(env[SCHEDULED_ORIGIN_VAR]);
  const audienceSet = present(env[SCHEDULED_AUDIENCE_VAR]);
  if (!originSet && !audienceSet) return null;
  if (!originSet) throw new Error(`${SCHEDULED_ORIGIN_VAR} must be set when ${SCHEDULED_AUDIENCE_VAR} is set`);
  const origin = httpsOrigin(SCHEDULED_ORIGIN_VAR, env[SCHEDULED_ORIGIN_VAR]);
  const trusted = present(env[TRUSTED_VAR]) ? String(env[TRUSTED_VAR]).split(',').map(s => s.trim()) : [];
  if (!trusted.includes(origin)) throw new Error(`${SCHEDULED_ORIGIN_VAR} must be listed in ${TRUSTED_VAR}`);
  if (!audienceSet) throw new Error(`${SCHEDULED_AUDIENCE_VAR} must be set when ${SCHEDULED_ORIGIN_VAR} is set`);
  const audience = env[SCHEDULED_AUDIENCE_VAR];
  if (audience === PLACEHOLDER || audience.length > 200 || audience !== audience.trim()) throw new Error(`${SCHEDULED_AUDIENCE_VAR} must be a non-placeholder audience of at most 200 characters`);
  if (audience === LINK_AUDIENCE) throw new Error(`${SCHEDULED_AUDIENCE_VAR} must not equal the link audience`);
  for (const name of PEER_AUDIENCE_VARS) {
    if (env[name] === audience) throw new Error(`${SCHEDULED_AUDIENCE_VAR} must differ from ${name} (one audience per app)`);
  }
  return { origin, audience };
}
