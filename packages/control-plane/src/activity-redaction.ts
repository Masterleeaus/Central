/** Redaction for the activity history (issue #36). Runs before every insert and fails closed.
 *
 * Two outcomes for a detail object:
 *  - REJECT (throws ActivityRedactionError): a key names a credential (token, secret, password,
 *    authorization, cookie, code verifier, ...), or a value looks like a credential or an email address,
 *    or the object is nested, too large or otherwise outside the schema. The whole event is refused.
 *  - STRIP: a key names personal data (email, phone, address, date of birth, name, IP address, ...).
 *    The key is removed and its name is returned so the caller can see what was dropped.
 *
 * The rules are deliberately conservative. A false positive refuses an event, which is visible to the
 * caller. A false negative would store a secret, which is not recoverable. Keep the rules here and in
 * migration 0011 (activity_detail_ok) in step.
 */

export class ActivityRedactionError extends Error {
 readonly reason: string;
 constructor(reason: string) {
  super(`activity event refused: ${reason}`);
  this.name = 'ActivityRedactionError';
  this.reason = reason;
 }
}

export type ActivityDetailValue = string | number | boolean | null;
export interface RedactedDetail {
 readonly detail: Readonly<Record<string, ActivityDetailValue>>;
 /** Names of personal-data keys that were removed. Names only, never values. */
 readonly stripped: readonly string[];
}

export const DETAIL_MAX_BYTES = 1024;
export const DETAIL_MAX_KEYS = 12;
export const DETAIL_MAX_STRING = 128;
export const TEXT_FIELD_MAX = 128;

const KEY_SHAPE = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;

/** Keys whose values are credentials. Matched after lower-casing and removing separators. */
const SECRET_KEY_PATTERN = /token|secret|passw|pwd|apikey|credential|privatekey|bearer|authori[sz]ation|cookie|session|verifier|nonce|assertion|jwt|signature/;
/** Keys whose values are personal data. Removed, not stored. */
const PERSONAL_KEY_PATTERN = /e?mail|phone|mobile|address|birth|dob|firstname|lastname|fullname|surname|givenname|forename|ipaddr|passport|nationalid|ssn|postcode|postal|dateofbirth|telephone/;

/** Value shapes that are refused wherever they appear. */
const VALUE_RULES: ReadonlyArray<readonly [string, RegExp]> = [
 ['email address', /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/],
 ['authorization scheme', /\b(bearer|basic|digest)\s+[A-Za-z0-9._~+/=-]{8,}/i],
 ['JSON web token', /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/],
 ['secret assignment', /\b(password|passwd|pwd|secret|token|api[_-]?key|authorization|cookie|client_secret)\s*[=:]/i],
 ['URL with credentials', /[a-z][a-z0-9+.-]*:\/\/[^\s/@]+:[^\s/@]+@/i],
];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normaliseKey(key: string): string {
 return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function refuseOpaqueToken(text: string): boolean {
 // A long run of token characters with both letters and digits and no separators is treated as a
 // credential or a digest. UUIDs are allowed because they are identifiers, not secrets.
 if (text.length < 32 || UUID.test(text)) return false;
 return /^[A-Za-z0-9_+/=-]+$/.test(text) && /[A-Za-z]/.test(text) && /[0-9]/.test(text);
}

/** Checks a short identifier (actor, target, action text). Throws on any credential or personal shape. */
export function assertSafeText(field: string, value: unknown, max = TEXT_FIELD_MAX): string {
 if (typeof value !== 'string' || value.length === 0 || value.length > max) {
  throw new ActivityRedactionError(`${field} must be a non-empty string of at most ${max} characters`);
 }
 if (/[\x00-\x1f\x7f]/.test(value)) throw new ActivityRedactionError(`${field} contains control characters`);
 for (const [label, rule] of VALUE_RULES) {
  if (rule.test(value)) throw new ActivityRedactionError(`${field} looks like ${label}`);
 }
 if (refuseOpaqueToken(value)) throw new ActivityRedactionError(`${field} looks like a credential`);
 return value;
}

function checkValue(key: string, value: unknown): ActivityDetailValue {
 if (value === null || typeof value === 'boolean') return value;
 if (typeof value === 'number') {
  if (!Number.isFinite(value)) throw new ActivityRedactionError(`detail.${key} is not a finite number`);
  return value;
 }
 if (typeof value === 'string') {
  if (value.length > DETAIL_MAX_STRING) throw new ActivityRedactionError(`detail.${key} is longer than ${DETAIL_MAX_STRING} characters`);
  if (/[\x00-\x1f\x7f]/.test(value)) throw new ActivityRedactionError(`detail.${key} contains control characters`);
  for (const [label, rule] of VALUE_RULES) {
   if (rule.test(value)) throw new ActivityRedactionError(`detail.${key} looks like ${label}`);
  }
  if (refuseOpaqueToken(value)) throw new ActivityRedactionError(`detail.${key} looks like a credential`);
  return value;
 }
 if (Array.isArray(value)) throw new ActivityRedactionError(`detail.${key} is an array; only scalar values are stored`);
 if (typeof value === 'object') throw new ActivityRedactionError(`detail.${key} is nested; only scalar values are stored`);
 throw new ActivityRedactionError(`detail.${key} has an unsupported type`);
}

/** Redacts a detail object. Throws ActivityRedactionError for anything that must not be stored. */
export function redactActivityDetail(input: unknown): RedactedDetail {
 if (input === undefined || input === null) return { detail: {}, stripped: [] };
 const proto = typeof input === 'object' && input !== null ? Object.getPrototypeOf(input) : undefined;
 if (typeof input !== 'object' || Array.isArray(input) || (proto !== Object.prototype && proto !== null)) {
  throw new ActivityRedactionError('detail must be a plain object');
 }
 const entries = Object.entries(input as Record<string, unknown>);
 if (entries.length > DETAIL_MAX_KEYS) throw new ActivityRedactionError(`detail has more than ${DETAIL_MAX_KEYS} keys`);
 const out: Record<string, ActivityDetailValue> = {};
 const stripped: string[] = [];
 for (const [key, value] of entries) {
  if (!KEY_SHAPE.test(key)) throw new ActivityRedactionError('detail key has an invalid shape');
  const norm = normaliseKey(key);
  if (SECRET_KEY_PATTERN.test(norm)) throw new ActivityRedactionError(`detail.${key} names a credential`);
  if (PERSONAL_KEY_PATTERN.test(norm)) { stripped.push(key); continue; }
  out[key] = checkValue(key, value);
 }
 // Measured in the form PostgreSQL stores for jsonb ("key": value, separated by ", "), so this bound matches
 // octet_length(detail::text) in migration 0011.
 const jsonbText = `{${Object.entries(out).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(', ')}}`;
 if (new TextEncoder().encode(jsonbText).length > DETAIL_MAX_BYTES) {
  throw new ActivityRedactionError(`detail is larger than ${DETAIL_MAX_BYTES} bytes`);
 }
 return { detail: out, stripped };
}
