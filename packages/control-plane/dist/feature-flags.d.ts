export declare const FLAG_PRODUCTS: readonly ["sorted", "supercharged", "lms", "central"];
export type FlagProduct = (typeof FLAG_PRODUCTS)[number];
export declare const FLAG_ENVIRONMENTS: readonly ["development", "staging", "production"];
export type FlagEnvironment = (typeof FLAG_ENVIRONMENTS)[number];
export type FlagValue = boolean | string | number;
export type FlagSpec = {
    readonly type: 'boolean';
} | {
    readonly type: 'enum';
    readonly values: readonly string[];
} | {
    readonly type: 'integer';
    readonly min: number;
    readonly max: number;
};
export interface FlagDeclaration {
    readonly product: FlagProduct;
    readonly key: string;
    readonly owner: string;
    readonly spec: FlagSpec;
    readonly default: FlagValue;
}
export type FlagErrorCode = 'INVALID_DECLARATION' | 'UNDECLARED_FLAG' | 'INVALID_REQUEST' | 'FORBIDDEN_FIELD' | 'INVALID_VALUE' | 'INVALID_TARGETING' | 'STALE_REVISION' | 'UNKNOWN_REVISION' | 'ROLLBACK_REFUSED' | 'STORE_UNAVAILABLE' | 'INVALID_CONFIGURATION';
export declare class FlagError extends Error {
    readonly code: FlagErrorCode;
    constructor(code: FlagErrorCode, message: string);
}
export declare function isValidValue(spec: FlagSpec, value: unknown): value is FlagValue;
/** The JSON stored in titan.feature_flags.allowed_values for a declared type. */
export declare function allowedValuesJson(spec: FlagSpec): unknown;
export interface FlagRegistry {
    get(product: FlagProduct, key: string): FlagDeclaration;
    list(): readonly FlagDeclaration[];
}
/** Builds the registry. Rejects an invalid declaration, a default outside its type, or a duplicate key. */
export declare function createFlagRegistry(declarations: readonly FlagDeclaration[]): FlagRegistry;
/** Brand that only trustVerifiedContext sets. The resolver refuses any context without it. */
export declare const VERIFIED_CONTEXT: unique symbol;
export interface VerifiedContext {
    readonly organisationId: string | null;
    readonly cohorts: readonly string[];
    readonly [VERIFIED_CONTEXT]: true;
}
/**
 * Builds the context the resolver trusts. Call only from the authentication layer, after the
 * caller's token or mTLS identity has been verified, and take organisationId from those verified
 * claims. Nothing in a request body or query string may be passed here.
 */
export declare function trustVerifiedContext(input: {
    organisationId: string | null;
    cohorts?: readonly string[];
}): VerifiedContext;
export interface FlagScope {
    readonly product: FlagProduct;
    readonly environment: FlagEnvironment;
    readonly flagKey: string;
    readonly organisationId: string | null;
}
/** One titan.feature_flags row. `allowed`, `defaultValue` and `value` are JSON values from the store. */
export interface FlagRow extends FlagScope {
    readonly flagType: FlagSpec['type'];
    readonly allowed: unknown;
    readonly defaultValue: unknown;
    readonly owner: string;
    readonly value: unknown;
    readonly rolloutPercent: number | null;
    readonly cohort: string | null;
    readonly expiresAt: Date | null;
    readonly revision: number;
}
export interface FlagSnapshot {
    readonly flagType: FlagSpec['type'];
    readonly allowed: unknown;
    readonly defaultValue: unknown;
    readonly owner: string;
    readonly value: unknown;
    readonly rolloutPercent: number | null;
    readonly cohort: string | null;
    readonly expiresAt: string | null;
}
export interface HistoryEntry {
    readonly scope: FlagScope;
    readonly revision: number;
    readonly action: 'create' | 'set' | 'rollback';
    readonly rollbackToRevision: number | null;
    readonly snapshot: FlagSnapshot;
    readonly actor: string;
    readonly reason: string;
}
/**
 * Storage port. readScopes returns the global row and, when organisationId is set, that
 * organisation's row, and nothing else. commit must apply `next` only if the stored revision is
 * still expectedRevision (0 for a scope that does not exist yet), and must record `entry` in the
 * same transaction. It throws FlagError('STALE_REVISION') when the revision has moved.
 */
export interface FlagStore {
    readScopes(query: FlagScope): Promise<readonly FlagRow[]>;
    readHistory(scope: FlagScope, revision: number): Promise<HistoryEntry | null>;
    commit(input: {
        scope: FlagScope;
        expectedRevision: number;
        next: FlagRow;
        entry: HistoryEntry;
    }): Promise<void>;
}
export interface FlagDeps {
    readonly registry: FlagRegistry;
    readonly store: FlagStore;
    readonly now?: () => Date;
    /** Store read deadline. A read that takes longer resolves to the declared default. */
    readonly storeTimeoutMs?: number;
}
/** Stable bucket 0..99 for (organisation, flag). Same inputs always give the same bucket. */
export declare function rolloutBucket(organisationId: string, flagKey: string): number;
export type FlagSource = 'override' | 'cohort' | 'rollout' | 'global' | 'default' | 'fallback';
export interface FlagResolution {
    readonly value: FlagValue;
    readonly source: FlagSource;
    readonly revision: number | null;
    readonly reason?: 'store-unavailable' | 'invalid-configuration';
}
export interface FlagRequest {
    readonly product: FlagProduct;
    readonly environment: FlagEnvironment;
    readonly key: string;
}
/**
 * Resolves the value of one flag for the verified organisation. The request may carry only
 * product, environment and key. An organisation or tenant field in the request is refused, so the
 * organisation can only come from the verified context.
 */
export declare function resolveFlag(deps: FlagDeps, request: FlagRequest, context: VerifiedContext): Promise<FlagResolution>;
export interface FlagChange {
    readonly product: FlagProduct;
    readonly environment: FlagEnvironment;
    readonly key: string;
    /** null for the global scope, otherwise the organisation the override applies to. */
    readonly organisationId: string | null;
    /** The revision the caller last read. 0 means the scope does not exist yet. */
    readonly expectedRevision: number;
    readonly value: FlagValue;
    readonly rolloutPercent?: number | null;
    readonly cohort?: string | null;
    /** Required for an organisation override. Must be in the future. */
    readonly expiresAt?: Date | null;
    readonly actor: string;
    readonly reason: string;
}
export interface RollbackRequest {
    readonly product: FlagProduct;
    readonly environment: FlagEnvironment;
    readonly key: string;
    readonly organisationId: string | null;
    readonly expectedRevision: number;
    /** The history revision whose values are restored. */
    readonly toRevision: number;
    readonly actor: string;
    readonly reason: string;
}
/** Sets a flag scope to a new value. Refuses a stale expected revision. Returns the new revision. */
export declare function changeFlag(deps: FlagDeps, change: FlagChange): Promise<number>;
/**
 * Restores the values recorded at toRevision as a new revision, recorded with action 'rollback'.
 * Refuses an unknown revision, a snapshot whose expiry has passed, and a stale expected revision.
 */
export declare function rollbackFlag(deps: FlagDeps, req: RollbackRequest): Promise<number>;
