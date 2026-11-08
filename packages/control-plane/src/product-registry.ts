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

export const PRODUCT_IDS = ['sorted', 'supercharged', 'lms'] as const;
export type ProductId = (typeof PRODUCT_IDS)[number];

/** Capabilities every product must declare for the draft contract. */
export const REQUIRED_CAPABILITIES = ['health', 'version', 'tenant-link:verify'] as const;

export type TenantKeyKind = 'sorted.account_id' | 'supercharged.company_account' | 'lms.companyRef';

const EXPECTED_TENANT_KEY: Readonly<Record<ProductId, TenantKeyKind>> = {
  sorted: 'sorted.account_id',
  supercharged: 'supercharged.company_account',
  lms: 'lms.companyRef',
};

/** Legacy application id -> canonical product id. The issue's ordering is field/desk/academy -> Sorted/Supercharged/LMS. */
export const LEGACY_TO_PRODUCT: Readonly<Record<ApplicationId, ProductId>> = {
  field: 'sorted',
  desk: 'supercharged',
  academy: 'lms',
};

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
  repository: { owner: string; name: string };
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

export const PRODUCT_DEFINITIONS: readonly ProductDefinition[] = [
  {
    id: 'sorted',
    legacyId: 'field',
    displayName: 'Sorted',
    repository: { owner: 'Masterleeaus', name: 'Sorted' },
    audience: 'urn:titan-central:product:sorted',
    contractVersion: '0.1.0-draft',
    capabilities: ['health', 'version', 'tenant-link:verify', 'jobs:read', 'visits:read'],
    tenantKey: { kind: 'sorted.account_id', field: 'account_id' },
  },
  {
    id: 'supercharged',
    legacyId: 'desk',
    displayName: 'Supercharged',
    repository: { owner: 'Masterleeaus', name: 'Supercharged' },
    audience: 'urn:titan-central:product:supercharged',
    contractVersion: '0.1.0-draft',
    capabilities: ['health', 'version', 'tenant-link:verify', 'communications:read', 'agents:read'],
    tenantKey: { kind: 'supercharged.company_account', field: 'company_account_id' },
  },
  {
    id: 'lms',
    legacyId: 'academy',
    displayName: 'LMS',
    repository: { owner: 'Masterleeaus', name: 'Skilled' },
    audience: 'urn:titan-central:product:lms',
    contractVersion: '0.1.0-draft',
    capabilities: ['health', 'version', 'tenant-link:verify', 'courses:read', 'certificates:read'],
    tenantKey: { kind: 'lms.companyRef', field: 'companyRef' },
  },
];

export type RegistryErrorCode =
  | 'unknown_product'
  | 'missing_product'
  | 'unknown_legacy_id'
  | 'legacy_mapping_mismatch'
  | 'duplicate_id'
  | 'duplicate_legacy_id'
  | 'duplicate_audience'
  | 'duplicate_repository'
  | 'duplicate_origin'
  | 'invalid_contract_version'
  | 'missing_required_capability'
  | 'invalid_tenant_key'
  | 'untrusted_origin';

export class ProductRegistryError extends Error {
  readonly code: RegistryErrorCode;
  constructor(code: RegistryErrorCode, message: string) {
    super(message);
    this.name = 'ProductRegistryError';
    this.code = code;
  }
}

export interface DefinitionProblem {
  code: RegistryErrorCode;
  message: string;
}

const VERSION_PATTERN = /^\d+\.\d+\.\d+(-draft)?$/;

function isKnownProductId(value: unknown): value is ProductId {
  return typeof value === 'string' && (PRODUCT_IDS as readonly string[]).includes(value);
}

function isKnownLegacyId(value: unknown): value is ApplicationId {
  return typeof value === 'string' && Object.hasOwn(LEGACY_TO_PRODUCT, value);
}

/** Returns every rule violation in the definitions. Empty array means valid. */
export function findDefinitionProblems(definitions: readonly ProductDefinition[]): DefinitionProblem[] {
  const problems: DefinitionProblem[] = [];
  const ids = new Set<string>();
  const legacy = new Set<string>();
  const audiences = new Set<string>();
  const repos = new Set<string>();

  for (const def of definitions) {
    if (!isKnownProductId(def.id)) {
      problems.push({ code: 'unknown_product', message: `unknown product id: ${String(def.id)}` });
      continue;
    }
    if (ids.has(def.id)) problems.push({ code: 'duplicate_id', message: `duplicate product id: ${def.id}` });
    ids.add(def.id);

    if (!isKnownLegacyId(def.legacyId)) {
      problems.push({ code: 'unknown_legacy_id', message: `unknown legacy id: ${String(def.legacyId)}` });
    } else {
      if (LEGACY_TO_PRODUCT[def.legacyId] !== def.id) {
        problems.push({ code: 'legacy_mapping_mismatch', message: `${def.legacyId} does not map to ${def.id}` });
      }
      if (legacy.has(def.legacyId)) {
        problems.push({ code: 'duplicate_legacy_id', message: `duplicate legacy id: ${def.legacyId}` });
      }
      legacy.add(def.legacyId);
    }

    if (audiences.has(def.audience)) {
      problems.push({ code: 'duplicate_audience', message: `duplicate audience: ${def.audience}` });
    }
    audiences.add(def.audience);

    const repoName = `${def.repository.owner}/${def.repository.name}`;
    if (repos.has(repoName)) problems.push({ code: 'duplicate_repository', message: `duplicate repository: ${repoName}` });
    repos.add(repoName);

    if (!VERSION_PATTERN.test(def.contractVersion)) {
      problems.push({ code: 'invalid_contract_version', message: `${def.id} has invalid contract version` });
    }

    for (const required of REQUIRED_CAPABILITIES) {
      if (!def.capabilities.includes(required)) {
        problems.push({ code: 'missing_required_capability', message: `${def.id} lacks capability ${required}` });
      }
    }

    if (def.tenantKey.kind !== EXPECTED_TENANT_KEY[def.id]) {
      problems.push({ code: 'invalid_tenant_key', message: `${def.id} has tenant key ${def.tenantKey.kind}` });
    }
  }

  for (const id of PRODUCT_IDS) {
    if (!ids.has(id)) problems.push({ code: 'missing_product', message: `missing product: ${id}` });
  }
  return problems;
}

const FORBIDDEN_HOST_SUFFIXES = ['github.com', 'github.io', 'githubusercontent.com'] as const;

/**
 * Accepts only an HTTPS origin on a public DNS name, with default port and no
 * credentials, path, query or fragment. Returns the normalised origin.
 */
export function normaliseTrustedOrigin(input: string): string {
  const fail = (why: string): never => {
    throw new ProductRegistryError('untrusted_origin', `service origin rejected: ${why}`);
  };
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return fail('not a URL');
  }
  if (url.protocol !== 'https:') fail('must be HTTPS');
  if (url.username || url.password) fail('must not contain credentials');
  if (url.search || url.hash) fail('must not contain a query or fragment');
  if (url.pathname !== '/') fail('must be an origin without a path');
  if (url.port !== '') fail('must use the default HTTPS port');
  const host = url.hostname;
  if (!host.includes('.') || host === 'localhost' || host.endsWith('.localhost')) fail('must be a public DNS name');
  if (/^[0-9.]+$/.test(host) || host.includes(':')) fail('must not be an IP literal');
  for (const suffix of FORBIDDEN_HOST_SUFFIXES) {
    if (host === suffix || host.endsWith(`.${suffix}`)) fail('repository hosts are not service origins');
  }
  return url.origin;
}

/**
 * Validates definitions and operator configuration, then returns the registry.
 * Throws ProductRegistryError on the first problem found.
 */
export function buildProductRegistry(
  config: ProductOperatorConfig,
  definitions: readonly ProductDefinition[] = PRODUCT_DEFINITIONS,
): readonly RegisteredProduct[] {
  const [first] = findDefinitionProblems(definitions);
  if (first) throw new ProductRegistryError(first.code, first.message);

  for (const key of Object.keys(config.serviceOrigins)) {
    if (!isKnownProductId(key)) throw new ProductRegistryError('unknown_product', `origin configured for unknown product: ${key}`);
  }

  const trusted = new Set(config.trustedOrigins.map(normaliseTrustedOrigin));
  const seen = new Map<string, ProductId>();

  return definitions.map((def): RegisteredProduct => {
    const raw = config.serviceOrigins[def.id];
    if (raw === undefined) return { ...def, serviceOrigin: null };
    const origin = normaliseTrustedOrigin(raw);
    if (!trusted.has(origin)) {
      throw new ProductRegistryError('untrusted_origin', `${def.id} origin is not on the operator allowlist`);
    }
    const other = seen.get(origin);
    if (other !== undefined) {
      throw new ProductRegistryError('duplicate_origin', `${def.id} and ${other} share an origin`);
    }
    seen.set(origin, def.id);
    return { ...def, serviceOrigin: origin };
  });
}

/** Resolves a canonical product id. Legacy ids and unknown values are rejected. */
export function resolveProduct(registry: readonly RegisteredProduct[], id: unknown): RegisteredProduct {
  const found = typeof id === 'string' ? registry.find((p) => p.id === id) : undefined;
  if (!found) throw new ProductRegistryError('unknown_product', `unknown product: ${String(id)}`);
  return found;
}

/** Resolves a legacy application id (field, desk, academy) to its registered product. */
export function resolveLegacyId(registry: readonly RegisteredProduct[], legacy: unknown): RegisteredProduct {
  if (!isKnownLegacyId(legacy)) throw new ProductRegistryError('unknown_legacy_id', `unknown legacy id: ${String(legacy)}`);
  return resolveProduct(registry, LEGACY_TO_PRODUCT[legacy]);
}

export function toCanonicalProductId(legacy: ApplicationId): ProductId {
  return LEGACY_TO_PRODUCT[legacy];
}

export function toLegacyApplicationId(product: ProductId): ApplicationId {
  const entry = (Object.keys(LEGACY_TO_PRODUCT) as ApplicationId[]).find((k) => LEGACY_TO_PRODUCT[k] === product);
  if (!entry) throw new ProductRegistryError('unknown_product', `no legacy id for ${String(product)}`);
  return entry;
}

/**
 * Repository identity is informational. The result carries accessGranted: false
 * as a literal type, so callers cannot treat a repository match as authorisation.
 */
export interface RepositoryIdentity {
  product: RegisteredProduct;
  accessGranted: false;
}

export function repositoryIdentity(registry: readonly RegisteredProduct[], fullName: string): RepositoryIdentity | undefined {
  const product = registry.find((p) => `${p.repository.owner}/${p.repository.name}` === fullName);
  return product ? { product, accessGranted: false } : undefined;
}

export type TenantCheck = { ok: true } | { ok: false; code: 'missing_tenant' | 'cross_tenant' };

/**
 * The verified tenant key must come from the product that owns the account.
 * A requested key that differs from it is a cross-tenant request.
 */
export function checkTenantReference(verifiedTenantKey: string | undefined, requestedTenantKey: string | undefined): TenantCheck {
  if (!verifiedTenantKey || !requestedTenantKey) return { ok: false, code: 'missing_tenant' };
  if (verifiedTenantKey !== requestedTenantKey) return { ok: false, code: 'cross_tenant' };
  return { ok: true };
}

export interface ContractConfig {
  /** Contract version Central has configured for this product. */
  contractVersion: string | undefined;
  /** Capabilities Central has configured as supported for this product. */
  capabilities: readonly string[];
}

export type ContractFindingCode =
  | 'contract_version_missing'
  | 'contract_version_mismatch'
  | 'missing_capability'
  | 'undeclared_capability';

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
export function inspectProductContract(product: ProductDefinition, configured: ContractConfig): ContractInspection {
  const findings: ContractFinding[] = [];
  if (configured.contractVersion === undefined) {
    findings.push({ code: 'contract_version_missing', detail: 'no contract version configured' });
  } else if (configured.contractVersion !== product.contractVersion) {
    findings.push({
      code: 'contract_version_mismatch',
      detail: `configured ${configured.contractVersion}, registry expects ${product.contractVersion}`,
    });
  }
  for (const required of REQUIRED_CAPABILITIES) {
    if (!configured.capabilities.includes(required)) {
      findings.push({ code: 'missing_capability', detail: `capability ${required} not configured` });
    }
  }
  for (const cap of configured.capabilities) {
    if (!product.capabilities.includes(cap)) {
      findings.push({ code: 'undeclared_capability', detail: `capability ${cap} is not declared for ${product.id}` });
    }
  }
  return { productId: product.id, compatible: findings.length === 0, findings };
}
