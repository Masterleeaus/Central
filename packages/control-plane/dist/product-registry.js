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
export const PRODUCT_IDS = ['sorted', 'supercharged', 'lms'];
/** Capabilities every product must declare for the draft contract. */
export const REQUIRED_CAPABILITIES = ['health', 'version', 'tenant-link:verify'];
const EXPECTED_TENANT_KEY = {
    sorted: 'sorted.account_id',
    supercharged: 'supercharged.company_account',
    lms: 'lms.companyRef',
};
/** Legacy application id -> canonical product id. The issue's ordering is field/desk/academy -> Sorted/Supercharged/LMS. */
export const LEGACY_TO_PRODUCT = {
    field: 'sorted',
    desk: 'supercharged',
    academy: 'lms',
};
export const PRODUCT_DEFINITIONS = [
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
export class ProductRegistryError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = 'ProductRegistryError';
        this.code = code;
    }
}
const VERSION_PATTERN = /^\d+\.\d+\.\d+(-draft)?$/;
function isKnownProductId(value) {
    return typeof value === 'string' && PRODUCT_IDS.includes(value);
}
function isKnownLegacyId(value) {
    return typeof value === 'string' && Object.hasOwn(LEGACY_TO_PRODUCT, value);
}
/** Returns every rule violation in the definitions. Empty array means valid. */
export function findDefinitionProblems(definitions) {
    const problems = [];
    const ids = new Set();
    const legacy = new Set();
    const audiences = new Set();
    const repos = new Set();
    for (const def of definitions) {
        if (!isKnownProductId(def.id)) {
            problems.push({ code: 'unknown_product', message: `unknown product id: ${String(def.id)}` });
            continue;
        }
        if (ids.has(def.id))
            problems.push({ code: 'duplicate_id', message: `duplicate product id: ${def.id}` });
        ids.add(def.id);
        if (!isKnownLegacyId(def.legacyId)) {
            problems.push({ code: 'unknown_legacy_id', message: `unknown legacy id: ${String(def.legacyId)}` });
        }
        else {
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
        if (repos.has(repoName))
            problems.push({ code: 'duplicate_repository', message: `duplicate repository: ${repoName}` });
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
        if (!ids.has(id))
            problems.push({ code: 'missing_product', message: `missing product: ${id}` });
    }
    return problems;
}
const FORBIDDEN_HOST_SUFFIXES = ['github.com', 'github.io', 'githubusercontent.com'];
/**
 * Accepts only an HTTPS origin on a public DNS name, with default port and no
 * credentials, path, query or fragment. Returns the normalised origin.
 */
export function normaliseTrustedOrigin(input) {
    const fail = (why) => {
        throw new ProductRegistryError('untrusted_origin', `service origin rejected: ${why}`);
    };
    let url;
    try {
        url = new URL(input);
    }
    catch {
        return fail('not a URL');
    }
    if (url.protocol !== 'https:')
        fail('must be HTTPS');
    if (url.username || url.password)
        fail('must not contain credentials');
    if (url.search || url.hash)
        fail('must not contain a query or fragment');
    if (url.pathname !== '/')
        fail('must be an origin without a path');
    if (url.port !== '')
        fail('must use the default HTTPS port');
    const host = url.hostname;
    if (!host.includes('.') || host === 'localhost' || host.endsWith('.localhost'))
        fail('must be a public DNS name');
    if (/^[0-9.]+$/.test(host) || host.includes(':'))
        fail('must not be an IP literal');
    for (const suffix of FORBIDDEN_HOST_SUFFIXES) {
        if (host === suffix || host.endsWith(`.${suffix}`))
            fail('repository hosts are not service origins');
    }
    return url.origin;
}
/**
 * Validates definitions and operator configuration, then returns the registry.
 * Throws ProductRegistryError on the first problem found.
 */
export function buildProductRegistry(config, definitions = PRODUCT_DEFINITIONS) {
    const [first] = findDefinitionProblems(definitions);
    if (first)
        throw new ProductRegistryError(first.code, first.message);
    for (const key of Object.keys(config.serviceOrigins)) {
        if (!isKnownProductId(key))
            throw new ProductRegistryError('unknown_product', `origin configured for unknown product: ${key}`);
    }
    const trusted = new Set(config.trustedOrigins.map(normaliseTrustedOrigin));
    const seen = new Map();
    return definitions.map((def) => {
        const raw = config.serviceOrigins[def.id];
        if (raw === undefined)
            return { ...def, serviceOrigin: null };
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
export function resolveProduct(registry, id) {
    const found = typeof id === 'string' ? registry.find((p) => p.id === id) : undefined;
    if (!found)
        throw new ProductRegistryError('unknown_product', `unknown product: ${String(id)}`);
    return found;
}
/** Resolves a legacy application id (field, desk, academy) to its registered product. */
export function resolveLegacyId(registry, legacy) {
    if (!isKnownLegacyId(legacy))
        throw new ProductRegistryError('unknown_legacy_id', `unknown legacy id: ${String(legacy)}`);
    return resolveProduct(registry, LEGACY_TO_PRODUCT[legacy]);
}
export function toCanonicalProductId(legacy) {
    return LEGACY_TO_PRODUCT[legacy];
}
export function toLegacyApplicationId(product) {
    const entry = Object.keys(LEGACY_TO_PRODUCT).find((k) => LEGACY_TO_PRODUCT[k] === product);
    if (!entry)
        throw new ProductRegistryError('unknown_product', `no legacy id for ${String(product)}`);
    return entry;
}
export function repositoryIdentity(registry, fullName) {
    const product = registry.find((p) => `${p.repository.owner}/${p.repository.name}` === fullName);
    return product ? { product, accessGranted: false } : undefined;
}
/**
 * The verified tenant key must come from the product that owns the account.
 * A requested key that differs from it is a cross-tenant request.
 */
export function checkTenantReference(verifiedTenantKey, requestedTenantKey) {
    if (!verifiedTenantKey || !requestedTenantKey)
        return { ok: false, code: 'missing_tenant' };
    if (verifiedTenantKey !== requestedTenantKey)
        return { ok: false, code: 'cross_tenant' };
    return { ok: true };
}
/** Pure inspection of configured contract version and capabilities. No network calls. */
export function inspectProductContract(product, configured) {
    const findings = [];
    if (configured.contractVersion === undefined) {
        findings.push({ code: 'contract_version_missing', detail: 'no contract version configured' });
    }
    else if (configured.contractVersion !== product.contractVersion) {
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
