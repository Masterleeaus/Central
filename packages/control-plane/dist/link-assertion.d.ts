import type { ApplicationId } from './contracts.js';
import { type ProductId } from './product-registry.js';
import type { SqlPool } from './postgres.js';
import type { VerifyLocalLink } from './trusted-provisioning.js';
export declare const LINK_ASSERTION_AUDIENCE = "titan-central";
export declare const LINK_ASSERTION_TYPE = "titan-link+jwt";
/** Maximum exp minus iat. Nonces need only be remembered until exp, so this bounds the replay window. */
export declare const LINK_ASSERTION_MAX_LIFETIME_SECONDS = 300;
/** Tolerated clock difference for iat (future-dated) only. exp is never extended by skew. */
export declare const LINK_ASSERTION_CLOCK_SKEW_SECONDS = 30;
export declare const LINK_ASSERTION_MAX_KEYS_PER_PRODUCT = 8;
export interface LinkPublicJwk {
    kty: 'OKP';
    crv: 'Ed25519';
    x: string;
}
export interface LinkKeyConfig {
    /** Key ID carried in the JWS header. Unique within its product. */
    kid: string;
    jwk: LinkPublicJwk;
    /** Key accepted from this instant (ISO 8601). Rotation: publish the new key before products switch to it. */
    notBefore: string;
    /** Key rejected from this instant (ISO 8601). Omit while the key is current. */
    notAfter?: string;
}
/** One key set per product. Keys are operator-controlled configuration, never read from a request. */
export interface ProductLinkKeySet {
    productId: ProductId;
    keys: readonly LinkKeyConfig[];
}
/** Atomic check-and-record. Returns true only when the nonce was unused; it is then kept until expiresAt. */
export interface LinkNonceStore {
    consume(productId: ProductId, nonce: string, expiresAt: string, now: string): Promise<boolean>;
}
export interface LinkAssertionExpectation {
    /** Legacy application id of the account being linked. Must map to the asserting product. */
    applicationId: ApplicationId;
    /** Central identity subject (Logto subject) resolved by Central from identities.id. */
    logtoSubject: string;
    /** Logto organisation ID resolved by Central from organisations.id. */
    logtoOrganisationId: string;
    localUserId: string;
    localAccountId: string;
}
export interface LinkAssertionResult {
    productId: ProductId;
    nonce: string;
    issuedAt: string;
    expiresAt: string;
}
export type LinkRejectionCode = 'malformed' | 'bad_algorithm' | 'unknown_product' | 'product_mismatch' | 'wrong_audience' | 'unknown_key' | 'key_inactive' | 'bad_signature' | 'forbidden_claim' | 'missing_claim' | 'identifier_not_permitted' | 'bad_lifetime' | 'future_dated' | 'expired' | 'replayed' | 'subject_mismatch' | 'organisation_mismatch' | 'account_mismatch';
export declare class LinkAssertionRejected extends Error {
    readonly code: LinkRejectionCode;
    constructor(code: LinkRejectionCode);
}
export declare class LinkAssertionVerifier {
    private readonly nonces;
    private readonly clock;
    private readonly keys;
    constructor(keySets: readonly ProductLinkKeySet[], nonces: LinkNonceStore, clock?: () => string);
    /** Throws LinkAssertionRejected with a fixed code. Nonce is consumed only after every other check passes. */
    verify(token: unknown, expected: LinkAssertionExpectation): Promise<LinkAssertionResult>;
}
/** Nonce store on PostgreSQL. Runs as titan_trusted_writer (migration 0014). Expired rows are pruned in the same
 * transaction, which bounds the table to the replay window: an assertion past expiry is rejected anyway. */
export declare function createPostgresLinkNonceStore(pool: SqlPool): LinkNonceStore;
/** The hook TrustedProvisioningService calls for link and link_relink. Subject and organisation come from Central's
 * own identity and organisation records, never from the command. Any rejection throws; it never returns false. */
export declare function verifyLinkCommand(verifier: LinkAssertionVerifier): VerifyLocalLink;
