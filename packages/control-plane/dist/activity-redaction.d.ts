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
export declare class ActivityRedactionError extends Error {
    readonly reason: string;
    constructor(reason: string);
}
export type ActivityDetailValue = string | number | boolean | null;
export interface RedactedDetail {
    readonly detail: Readonly<Record<string, ActivityDetailValue>>;
    /** Names of personal-data keys that were removed. Names only, never values. */
    readonly stripped: readonly string[];
}
export declare const DETAIL_MAX_BYTES = 1024;
export declare const DETAIL_MAX_KEYS = 12;
export declare const DETAIL_MAX_STRING = 128;
export declare const TEXT_FIELD_MAX = 128;
/** Checks a short identifier (actor, target, action text). Throws on any credential or personal shape. */
export declare function assertSafeText(field: string, value: unknown, max?: number): string;
/** Redacts a detail object. Throws ActivityRedactionError for anything that must not be stored. */
export declare function redactActivityDetail(input: unknown): RedactedDetail;
