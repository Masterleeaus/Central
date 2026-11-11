/** Route secret rotation. A consumer route holds either one open-ended secret (no rotation window) or up to
 * MAX_ROUTE_KEYS keys, each valid from notBefore (inclusive) to notAfter (exclusive). When two keys are given they
 * must overlap in time, so there is always a window in which both verify.
 *
 * Signing: the publisher signs with the valid key whose notBefore is latest (the current key).
 * Verification: a consumer accepts an envelope if ANY key valid at the verification time verifies it. An expired or
 * not-yet-valid key never verifies. The envelope carries no key id, so the signature is the only thing checked.
 *
 * Secrets are never placed in errors or logs. Error messages name the consumer and the field, never a value. */
export declare const MIN_SECRET_LENGTH = 32;
export declare const MAX_ROUTE_KEYS = 2;
/** One key of a consumer route. notBefore and notAfter are ISO 8601 instants with a time zone. */
export interface RouteKey {
    readonly id: string;
    readonly secret: string;
    readonly notBefore: string;
    readonly notAfter: string;
}
export interface ResolvedKey {
    readonly id: string;
    readonly secret: string;
    readonly notBeforeMs: number;
    readonly notAfterMs: number;
}
/** Either a single open-ended secret or a list of rotation keys. Exactly one of the two must be set. */
export interface KeyHolder {
    readonly consumer: string;
    readonly secret?: string;
    readonly keys?: readonly RouteKey[];
}
/** Validates a route's key configuration and returns it in resolved form. Throws OutboxError('invalid_field'). */
export declare function resolveRouteKeys(holder: KeyHolder): ResolvedKey[];
export declare function keyValidAt(key: ResolvedKey, nowMs: number): boolean;
/** The key the publisher signs with at nowMs: the valid key with the latest notBefore. Undefined when none is valid. */
export declare function signingKeyAt(keys: readonly ResolvedKey[], nowMs: number): ResolvedKey | undefined;
/** Verifies the HMAC over the canonical JSON of `unsigned` with any key valid at nowMs. Constant-time per key. */
export declare function verifySignatureWithKeys(unsigned: Record<string, unknown>, signature: unknown, keys: readonly ResolvedKey[], nowMs: number): boolean;
