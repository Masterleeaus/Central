/** Customer onboarding (issue #41): an idempotent state machine over titan.onboardings (migration 0017).
 *
 * Mutation boundary. This module changes product access only through TrustedProvisioningPort.apply, which is
 * TrustedProvisioningService.apply: operator authority, Logto checks, CentralProvisioner and the audit record.
 * It never writes identities, organisations, memberships, entitlements or links itself.
 *
 * State machine. canTransition mirrors the database trigger titan.onboarding_before_update, which is the
 * authority. The module checks first only to return a clear error:
 *   pending -> verified (owner identity proof) -> provisioned (every selected product succeeded)
 *   verified -> failed; failed -> verified (resume); failed -> failed (rollback, once, after revocation)
 *
 * Idempotency. Every onboarding ID, organisation ID, identity ID, membership, entitlement, link and provisioning
 * request ID is derived from the idempotency key and the step, so a retry names the same records and the
 * provisioner replays them instead of creating new ones. A key reused with a different request is refused.
 *
 * Owner and accounts. The owner is the authenticated principal's logtoSubject. Nothing matches an identity by
 * email: there is no email field, and the request is refused if one is supplied. A pre-existing product account
 * is linked only with a product-signed assertion, verified by the same path as issue #37.
 */
import { createHash } from 'node:crypto';
import { LinkReviewRequired } from './provisioning.js';
export const ONBOARDING_STATES = ['pending', 'verified', 'provisioned', 'failed'];
export const ONBOARDING_APPLICATIONS = ['desk', 'field', 'academy'];
const ALLOWED = {
    pending: ['verified', 'failed'],
    verified: ['provisioned', 'failed'],
    failed: ['verified'],
    provisioned: [],
};
export function canTransition(from, to) {
    return ALLOWED[from].includes(to);
}
export class OnboardingUniqueViolation extends Error {
    constructor() { super('onboarding uniqueness violated'); this.name = 'OnboardingUniqueViolation'; }
}
export class OnboardingStaleRevision extends Error {
    constructor() { super('onboarding changed concurrently'); this.name = 'OnboardingStaleRevision'; }
}
export class OnboardingError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = 'OnboardingError';
    }
}
const KEYS = new Set(['idempotencyKey', 'logtoOrganisationId', 'organisationName', 'products', 'existingAccounts']);
const CONTROL = /[\x00-\x1f\x7f]/;
const JWS = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const DIGEST = /^[0-9a-f]{64}$/;
function bad(message) { throw new OnboardingError('invalid_request', message); }
const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const sha256 = (text) => createHash('sha256').update(text).digest('hex');
/** Deterministic UUID from parts (version 5 bits). The same parts always name the same record. */
export function derivedUuid(...parts) {
    const b = createHash('sha256').update(parts.join('\u0000')).digest().subarray(0, 16);
    b[6] = (b[6] & 0x0f) | 0x50;
    b[8] = (b[8] & 0x3f) | 0x80;
    const x = b.toString('hex');
    return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}
function parseRequest(input) {
    if (!isObject(input))
        bad('request must be an object');
    for (const key of Object.keys(input))
        if (!KEYS.has(key))
            bad(`unsupported field: ${key}`);
    const { idempotencyKey, logtoOrganisationId, organisationName, products, existingAccounts } = input;
    if (typeof idempotencyKey !== 'string' || !/^[A-Za-z0-9._:-]{16,128}$/.test(idempotencyKey))
        bad('idempotencyKey must be 16 to 128 safe characters');
    if (typeof logtoOrganisationId !== 'string' || logtoOrganisationId.length === 0 || logtoOrganisationId.length > 256 || CONTROL.test(logtoOrganisationId))
        bad('logtoOrganisationId is invalid');
    if (typeof organisationName !== 'string' || organisationName.length === 0 || organisationName.length > 200 || organisationName !== organisationName.trim() || CONTROL.test(organisationName))
        bad('organisationName is invalid');
    if (!Array.isArray(products) || products.length < 1 || products.length > 3)
        bad('products must list one to three products');
    if (!products.every((p) => ONBOARDING_APPLICATIONS.includes(p)))
        bad('products must be desk, field or academy');
    if (new Set(products).size !== products.length)
        bad('products must be distinct');
    let accounts;
    if (existingAccounts !== undefined) {
        if (!isObject(existingAccounts))
            bad('existingAccounts must be an object');
        accounts = {};
        for (const [app, account] of Object.entries(existingAccounts)) {
            if (!products.includes(app))
                bad(`existingAccounts names an unselected product: ${app}`);
            if (!isObject(account))
                bad('an existing account must be an object');
            const { localUserId, localAccountId, assertion } = account;
            if (typeof localUserId !== 'string' || localUserId.length === 0 || localUserId.length > 256 || CONTROL.test(localUserId))
                bad('localUserId is invalid');
            if (typeof localAccountId !== 'string' || localAccountId.length === 0 || localAccountId.length > 256 || CONTROL.test(localAccountId))
                bad('localAccountId is invalid');
            if (typeof assertion !== 'string' || assertion.length > 4096 || !JWS.test(assertion))
                bad('an existing account needs a product-signed assertion');
            accounts[app] = { localUserId, localAccountId, assertion };
        }
    }
    return { idempotencyKey, logtoOrganisationId, organisationName, products: products, existingAccounts: accounts };
}
/** Digest of the request, bound to the owner. Assertions are hashed, so no signed token is stored. */
function requestDigest(ownerSubject, r) {
    const accounts = ONBOARDING_APPLICATIONS.filter((a) => r.existingAccounts?.[a] !== undefined).map((a) => {
        const account = r.existingAccounts[a];
        return [a, { localUserId: account.localUserId, localAccountId: account.localAccountId, assertionSha256: sha256(account.assertion) }];
    });
    return sha256(JSON.stringify({
        owner: ownerSubject,
        idempotencyKey: r.idempotencyKey,
        logtoOrganisationId: r.logtoOrganisationId,
        organisationName: r.organisationName,
        products: [...r.products].sort(),
        existingAccounts: Object.fromEntries(accounts),
    }));
}
/** Maps a provisioning error to a structured code. Only the code is stored; the message is not. */
function classify(error) {
    if (error instanceof LinkReviewRequired)
        return 'account_link_review';
    const message = error instanceof Error ? error.message : '';
    if (/forbidden|unverified provisioning actor|unverified application account control/.test(message))
        return 'not_authorised';
    if (/conflict|requires explicit|already|belongs to another/.test(message))
        return 'conflict';
    return 'provisioning_unavailable';
}
function assertOperator(operator) {
    if (!operator || operator.operatorAuthorityVerified !== true || typeof operator.logtoSubject !== 'string' || operator.logtoSubject.length === 0) {
        throw new OnboardingError('unauthenticated', 'operator authority is not verified');
    }
}
function assertOwner(owner) {
    if (!owner || owner.verified !== true || typeof owner.logtoSubject !== 'string' || owner.logtoSubject.length === 0) {
        throw new OnboardingError('unauthenticated', 'owner principal is not verified');
    }
}
export class OnboardingService {
    deps;
    constructor(deps) {
        this.deps = deps;
    }
    /** Starts an onboarding. Calling it again with the same key and request returns the same record and writes nothing. */
    async start(owner, input) {
        assertOwner(owner);
        const request = parseRequest(input);
        const store = this.deps.store;
        const digest = requestDigest(owner.logtoSubject, request);
        const existing = await store.findByKey(request.idempotencyKey);
        if (existing)
            return sameRequest(existing, digest);
        const id = derivedUuid('onboarding', request.idempotencyKey);
        const row = {
            id,
            idempotencyKey: request.idempotencyKey,
            organisationId: derivedUuid('organisation', id),
            logtoOrganisationId: request.logtoOrganisationId,
            ownerLogtoSubject: owner.logtoSubject,
            organisationName: request.organisationName,
            products: [...request.products].sort(),
            requestDigest: digest,
            state: 'pending',
            revision: 1,
        };
        try {
            await store.insert(row, { actorSubject: owner.logtoSubject, requestId: derivedUuid('request', id, 'start') });
        }
        catch (error) {
            if (!(error instanceof OnboardingUniqueViolation))
                throw error;
            // A concurrent start with the same key won the race: return its record if it is the same request.
            const raced = await store.findByKey(request.idempotencyKey);
            if (raced)
                return sameRequest(raced, digest);
            throw new OnboardingError('duplicate', 'this organisation or Logto organisation already has an onboarding');
        }
        return row;
    }
    /** Records the owner's identity proof. Required before any provisioning. A second proof does not change the record. */
    async proveOwner(owner, onboardingId, evidence) {
        assertOwner(owner);
        if (typeof evidence !== 'string' || evidence.length === 0 || evidence.length > 8192)
            bad('owner proof evidence is required');
        const row = await this.requireOwned(owner.logtoSubject, onboardingId);
        if (row.ownerProofDigest !== undefined)
            return row;
        if (row.state !== 'pending')
            throw new OnboardingError('invalid_state', `owner proof cannot be recorded while ${row.state}`);
        const digest = await this.deps.ownerProof.verify({ onboardingId: row.id, logtoSubject: owner.logtoSubject, evidence });
        if (typeof digest !== 'string' || !DIGEST.test(digest))
            throw new OnboardingError('owner_proof_rejected', 'owner identity proof was not accepted');
        return this.transition(row, { to: 'verified', ownerProofDigest: digest }, { actorSubject: owner.logtoSubject, requestId: derivedUuid('request', row.id, 'owner-proof', digest) });
    }
    /** Provisions the organisation, owner membership and each selected product. Safe to call again: completed steps are
     * replayed by the provisioner, and products that already succeeded are not granted again. A failed onboarding is resumed.
     * The request must be supplied again: its digest is checked, and the assertions are verified at each call. */
    async provision(operator, input) {
        assertOperator(operator);
        const request = parseRequest(input);
        let row = await this.requireByKey(request.idempotencyKey);
        if (requestDigest(row.ownerLogtoSubject, request) !== row.requestDigest)
            throw new OnboardingError('idempotency_conflict', 'request differs from the stored onboarding');
        if (row.rolledBackAt !== undefined)
            throw new OnboardingError('rolled_back', 'a rolled back onboarding cannot be provisioned');
        if (row.state === 'provisioned')
            return row;
        if (row.state === 'pending')
            throw new OnboardingError('invalid_state', 'owner identity proof is required before provisioning');
        const resumeCtx = { actorSubject: operator.logtoSubject, requestId: derivedUuid('request', row.id, 'resume', String(row.revision)) };
        if (row.state === 'failed')
            row = await this.transition(row, { to: 'verified' }, resumeCtx);
        const core = await this.ensureCore(operator, row);
        if (core === undefined) {
            return this.transition(row, { to: 'failed', failureCode: 'core_provisioning_failed' }, { actorSubject: operator.logtoSubject, requestId: derivedUuid('request', row.id, 'core-failed', String(row.revision)) });
        }
        const prior = new Map((await this.deps.store.products(row.id)).map((p) => [p.application, p]));
        for (const app of row.products) {
            const before = prior.get(app);
            if (before?.outcome === 'succeeded')
                continue;
            const next = await this.provisionProduct(operator, row, core.identityId, app, before, request.existingAccounts?.[app]);
            await this.deps.store.saveProduct(next, { actorSubject: operator.logtoSubject, requestId: derivedUuid('request', row.id, 'product', app, String(next.attempts)) });
            prior.set(app, next);
        }
        const allSucceeded = row.products.every((app) => prior.get(app)?.outcome === 'succeeded');
        const ctxFinal = { actorSubject: operator.logtoSubject, requestId: derivedUuid('request', row.id, 'final', String(row.revision)) };
        if (!allSucceeded)
            return this.transition(row, { to: 'failed', failureCode: 'product_provisioning_failed' }, ctxFinal);
        return this.transition(row, { to: 'provisioned' }, ctxFinal);
    }
    /** Revokes what this onboarding granted and marks it rolled back. Only a failed onboarding can be rolled back, and it cannot resume after. */
    async rollback(operator, onboardingId) {
        assertOperator(operator);
        const store = this.deps.store;
        let row = await this.requireById(onboardingId);
        if (row.rolledBackAt !== undefined)
            return row;
        if (row.state !== 'failed')
            throw new OnboardingError('invalid_state', 'only a failed onboarding can be rolled back');
        for (const product of await store.products(row.id)) {
            if (product.rolledBackAt !== undefined || (product.entitlementId === undefined && product.linkId === undefined))
                continue;
            if (product.linkId !== undefined) {
                const link = await store.link(row.organisationId, product.linkId);
                if (link && link.state !== 'revoked') {
                    await this.apply(operator, row, derivedUuid('request', row.id, 'rollback', product.application, 'link'), { kind: 'link_revoke', id: product.linkId, organisationId: row.organisationId, expectedRevision: link.revision });
                }
            }
            if (product.entitlementId !== undefined) {
                const entitlement = await store.entitlement(row.organisationId, product.entitlementId);
                if (entitlement && entitlement.state !== 'revoked') {
                    await this.apply(operator, row, derivedUuid('request', row.id, 'rollback', product.application, 'entitlement'), { kind: 'entitlement_update', id: product.entitlementId, organisationId: row.organisationId, expectedRevision: entitlement.revision, state: 'revoked' });
                }
            }
            await store.saveProduct({ ...product, rolledBackAt: new Date().toISOString() }, { actorSubject: operator.logtoSubject, requestId: derivedUuid('request', row.id, 'rollback-product', product.application) });
        }
        row = await this.transition(row, { to: 'failed', rolledBack: true }, { actorSubject: operator.logtoSubject, requestId: derivedUuid('request', row.id, 'rollback', String(row.revision)) });
        return row;
    }
    /** Progress for the owner. Another owner gets the same error as a missing record. */
    async progressForOwner(owner, onboardingId) {
        assertOwner(owner);
        const row = await this.requireOwned(owner.logtoSubject, onboardingId);
        return { ...row, productResults: await this.deps.store.products(row.id) };
    }
    /** Progress for a tenant. A record of another organisation gets the same error as a missing record. */
    async progressForOrganisation(organisationId, onboardingId) {
        const row = await this.requireById(onboardingId);
        if (row.organisationId !== organisationId)
            throw new OnboardingError('not_found', 'onboarding not found');
        return { ...row, productResults: await this.deps.store.products(row.id) };
    }
    async requireById(id) {
        const row = await this.deps.store.findById(id);
        if (!row)
            throw new OnboardingError('not_found', 'onboarding not found');
        return row;
    }
    async requireByKey(key) {
        const row = await this.deps.store.findByKey(key);
        if (!row)
            throw new OnboardingError('not_found', 'onboarding not found');
        return row;
    }
    async requireOwned(logtoSubject, id) {
        const row = await this.requireById(id);
        if (row.ownerLogtoSubject !== logtoSubject)
            throw new OnboardingError('not_found', 'onboarding not found');
        return row;
    }
    async transition(row, change, ctx) {
        const allowed = change.rolledBack === true ? row.state === 'failed' && row.rolledBackAt === undefined : canTransition(row.state, change.to);
        if (!allowed)
            throw new OnboardingError('invalid_state', `transition ${row.state} -> ${change.to} is not allowed`);
        try {
            return await this.deps.store.transition({ id: row.id, expectedRevision: row.revision, ...change }, ctx);
        }
        catch (error) {
            if (error instanceof OnboardingStaleRevision)
                throw new OnboardingError('stale_revision', 'onboarding changed concurrently; retry');
            throw error;
        }
    }
    async apply(operator, row, requestId, command) {
        return this.deps.provisioner.apply(operator, { actorSubject: operator.logtoSubject, authorityReference: `onboarding:${row.id}`, requestId }, command);
    }
    /** Identity, organisation and owner membership. Returns undefined when a step cannot be completed safely. */
    async ensureCore(operator, row) {
        const store = this.deps.store;
        try {
            const identity = await store.identityForSubject(row.ownerLogtoSubject);
            if (identity !== undefined && identity.state !== 'active')
                throw new Error('owner identity is not active');
            const identityId = identity?.id ?? derivedUuid('identity', row.ownerLogtoSubject);
            if (identity === undefined) {
                await this.apply(operator, row, derivedUuid('request', row.id, 'identity'), { kind: 'identity', id: identityId, logtoSubject: row.ownerLogtoSubject });
            }
            if (!(await store.organisationExists(row.organisationId))) {
                await this.apply(operator, row, derivedUuid('request', row.id, 'organisation'), { kind: 'organisation', id: row.organisationId, logtoOrganisationId: row.logtoOrganisationId });
            }
            const membership = await store.membershipFor(identityId, row.organisationId);
            // An existing membership that is not an active owner is never upgraded here: that would be an unintended grant.
            if (membership !== undefined && (membership.role !== 'owner' || membership.state !== 'active'))
                throw new Error('membership exists and is not an active owner');
            if (membership === undefined) {
                await this.apply(operator, row, derivedUuid('request', row.id, 'membership'), { kind: 'membership', id: derivedUuid('membership', row.id), identityId, organisationId: row.organisationId, role: 'owner' });
            }
            return { identityId };
        }
        catch {
            return undefined;
        }
    }
    async provisionProduct(operator, row, identityId, app, before, account) {
        const attempts = (before?.attempts ?? 0) + 1;
        const store = this.deps.store;
        const base = { onboardingId: row.id, organisationId: row.organisationId, application: app, accountLinkRequired: account !== undefined, attempts };
        // An entitlement ID is recorded only once its grant is confirmed in the store. A failed attempt records nothing,
        // so a resume attempts the grant again rather than trusting a reference to a row that does not exist.
        const confirmed = before?.entitlementId;
        let entitlementId = confirmed;
        const entitlementRequestId = derivedUuid('request', row.id, 'entitlement', app);
        try {
            if (entitlementId === undefined) {
                const candidate = derivedUuid('entitlement', row.id, app);
                await this.apply(operator, row, entitlementRequestId, { kind: 'entitlement', id: candidate, organisationId: row.organisationId, applicationId: app, features: [] });
                entitlementId = candidate;
            }
            // A replay returns "replayed" without writing. The row must exist, be granted to this organisation and product,
            // and be active. Otherwise the grant was not made.
            const granted = await store.entitlement(row.organisationId, entitlementId);
            if (!granted || granted.organisationId !== row.organisationId || granted.applicationId !== app || granted.state !== 'active') {
                return { ...base, outcome: 'failed', failureCode: 'provisioning_unavailable', entitlementId: confirmed, entitlementRequestId };
            }
        }
        catch (error) {
            return { ...base, outcome: 'failed', failureCode: classify(error), entitlementId: confirmed, entitlementRequestId };
        }
        if (account === undefined)
            return { ...base, outcome: 'succeeded', entitlementId, entitlementRequestId };
        const linkId = derivedUuid('link', row.id, app);
        const linkRequestId = derivedUuid('request', row.id, 'link', app);
        try {
            await this.apply(operator, row, linkRequestId, {
                kind: 'link', id: linkId, identityId, organisationId: row.organisationId, applicationId: app,
                localUserId: account.localUserId, localAccountId: account.localAccountId, assertion: account.assertion,
            });
            // A link sent to review commits an audit row under this request ID. A later replay returns "replayed" with no link.
            const linked = await store.link(row.organisationId, linkId);
            if (!linked || linked.organisationId !== row.organisationId || linked.applicationId !== app || linked.state !== 'verified') {
                return { ...base, outcome: 'failed', failureCode: 'account_link_review', entitlementId, entitlementRequestId };
            }
        }
        catch (error) {
            return { ...base, outcome: 'failed', failureCode: classify(error), entitlementId, entitlementRequestId };
        }
        return { ...base, outcome: 'succeeded', entitlementId, entitlementRequestId, linkId, linkRequestId };
    }
}
function sameRequest(existing, digest) {
    if (existing.requestDigest !== digest)
        throw new OnboardingError('idempotency_conflict', 'this idempotency key was used for a different onboarding');
    return existing;
}
