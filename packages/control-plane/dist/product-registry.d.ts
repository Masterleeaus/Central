import type { ApplicationId } from './contracts.js';
/**
 * Canonical product registry (issue #29).
 *
 * Additive: this module does not rename or replace the legacy application ids
 * in applications.ts (field, desk, academy). Access checks keep using those ids.
 * See docs/PRODUCT_REGISTRY.md for the migration status and the draft contracts.
 *
 * Pure module: no network calls, no environment reads. Runtime service origins
 * are supplied by the operator through ProductOperatorConfig.
 */
export declare const PRODUCT_IDS: readonly ["sorted", "supercharged", "lms"];
export type ProductId = (typeof PRODUCT_IDS)[number];
/** Capabilities every product must declare for the draft contract. */
export declare const REQUIRED_CAPABILITIES: readonly ["health", "version", "tenant-link:verify"];
export type TenantKeyKind = 'sorted.account_id' | 'supercharged.company_account' | 'lms.companyRef';
/** Legacy application id -> canonical product id. The issue's ordering is field/desk/academy -> Sorted/Supercharged/LMS. */
export declare const LEGACY_TO_PRODUCT: Readonly<Record<ApplicationId, ProductId>>;
export interface TenantKeyDefinition {
    kind: TenantKeyKind;
    /**
     * Name of the tenant/account key on the product side.
     * ASSUMED: taken from the issue text, not verified against the product repositories.
     */
    field: string;
}
export interface ProductDefinition {
    id: ProductId;
    legacyId: ApplicationId;
    displayName: string;
    /** GitHub repository identity. Informational only: it never grants access and never yields a service origin. */
    repository: {
        owner: string;
        name: string;
    };
    /** Token audience the product must accept. Unique per product. */
    audience: string;
    /** Draft contract version, for example "0.1.0-draft". */
    contractVersion: string;
    capabilities: readonly string[];
    tenantKey: TenantKeyDefinition;
}
export interface RegisteredProduct extends ProductDefinition {
    /** Trusted HTTPS origin from operator configuration, or null when not configured. */
    serviceOrigin: string | null;
}
export interface ProductOperatorConfig {
    /** Operator-supplied origins. Keys must be canonical product ids. */
    serviceOrigins: Partial<Record<ProductId, string>>;
    /** Operator allowlist. A well-formed origin that is not listed here is rejected. */
    trustedOrigins: readonly string[];
}
export declare const PRODUCT_DEFINITIONS: readonly ProductDefinition[];
export type RegistryErrorCode = 'unknown_product' | 'missing_product' | 'unknown_legacy_id' | 'legacy_mapping_mismatch' | 'duplicate_id' | 'duplicate_legacy_id' | 'duplicate_audience' | 'duplicate_repository' | 'duplicate_origin' | 'invalid_contract_version' | 'missing_required_capability' | 'invalid_tenant_key' | 'untrusted_origin';
export declare class ProductRegistryError extends Error {
    readonly code: RegistryErrorCode;
    constructor(code: RegistryErrorCode, message: string);
}
export interface DefinitionProblem {
    code: RegistryErrorCode;
    message: string;
}
/** Returns every rule violation in the definitions. Empty array means valid. */
export declare function findDefinitionProblems(definitions: readonly ProductDefinition[]): DefinitionProblem[];
/**
 * Accepts only an HTTPS origin on a public DNS name, with default port and no
 * credentials, path, query or fragment. Returns the normalised origin.
 */
export declare function normaliseTrustedOrigin(input: string): string;
/**
 * Validates definitions and operator configuration, then returns the registry.
 * Throws ProductRegistryError on the first problem found.
 */
export declare function buildProductRegistry(config: ProductOperatorConfig, definitions?: readonly ProductDefinition[]): readonly RegisteredProduct[];
/** Resolves a canonical product id. Legacy ids and unknown values are rejected. */
export declare function resolveProduct(registry: readonly RegisteredProduct[], id: unknown): RegisteredProduct;
/** Resolves a legacy application id (field, desk, academy) to its registered product. */
export declare function resolveLegacyId(registry: readonly RegisteredProduct[], legacy: unknown): RegisteredProduct;
export declare function toCanonicalProductId(legacy: ApplicationId): ProductId;
export declare function toLegacyApplicationId(product: ProductId): ApplicationId;
/**
 * Repository identity is informational. The result carries accessGranted: false
 * as a literal type, so callers cannot treat a repository match as authorisation.
 */
export interface RepositoryIdentity {
    product: RegisteredProduct;
    accessGranted: false;
}
export declare function repositoryIdentity(registry: readonly RegisteredProduct[], fullName: string): RepositoryIdentity | undefined;
export type TenantCheck = {
    ok: true;
} | {
    ok: false;
    code: 'missing_tenant' | 'cross_tenant';
};
/**
 * The verified tenant key must come from the product that owns the account.
 * A requested key that differs from it is a cross-tenant request.
 */
export declare function checkTenantReference(verifiedTenantKey: string | undefined, requestedTenantKey: string | undefined): TenantCheck;
export interface ContractConfig {
    /** Contract version Central has configured for this product. */
    contractVersion: string | undefined;
    /** Capabilities Central has configured as supported for this product. */
    capabilities: readonly string[];
}
export type ContractFindingCode = 'contract_version_missing' | 'contract_version_mismatch' | 'missing_capability' | 'undeclared_capability';
export interface ContractFinding {
    code: ContractFindingCode;
    detail: string;
}
export interface ContractInspection {
    productId: ProductId;
    compatible: boolean;
    findings: readonly ContractFinding[];
}
/** Pure inspection of configured contract version and capabilities. No network calls. */
export declare function inspectProductContract(product: ProductDefinition, configured: ContractConfig): ContractInspection;
