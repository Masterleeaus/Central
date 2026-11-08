/** One JSON object per line. Fields whose names look like credentials or identities are
 * dropped, and Error values are reduced to their class name, so tokens, subjects and
 * raw error messages cannot reach the log stream through this logger. */
const SENSITIVE = /^(sub|subject|logto_?subject|oidc_?subject|.*token.*|authorization|cookie|set-cookie|secret|.*verifier|.*password|code|state|nonce|email)$/i;
export function safeFields(fields = {}) {
  const out = {};
  for (const [key, value] of Object.entries(fields ?? {})) {
    if (SENSITIVE.test(key)) continue;
    if (value instanceof Error) out[key] = value.name;
    else if (typeof value === 'string') out[key] = value.slice(0, 200);
    else if (typeof value === 'number' || typeof value === 'boolean') out[key] = value;
  }
  return out;
}
export function createJsonLogger({ write = (line) => process.stderr.write(`${line}\n`), clock = () => new Date().toISOString() } = {}) {
  return (event, fields) => {
    try { write(JSON.stringify({ ts: clock(), ...safeFields(fields), event })); } catch { /* logging must never break a request */ }
  };
}
