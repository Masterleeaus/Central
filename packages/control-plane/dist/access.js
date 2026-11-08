import { getApplication } from './applications.js';
const deny = (reason) => ({ allowed: false, reason });
function validExpiry(expiry, now) { return !expiry || (Number.isFinite(Date.parse(expiry)) && Date.parse(expiry) > Date.parse(now)); }
function oneActive(values) { return values.length === 1 ? values[0] : undefined; }
/** Does not authenticate callers. `principal` MUST come from token-verifying OIDC middleware. */
export class CentralAccessService {
    repository;
    trust;
    constructor(repository, trust) {
        this.repository = repository;
        this.trust = trust;
    }
    async authorise(request) {
        const { principal, organisationId, applicationId, action } = request;
        const now = request.now ?? new Date().toISOString();
        if (!Number.isFinite(Date.parse(now)) || !principal || typeof principal.logtoSubject !== 'string' || !principal.logtoSubject.trim() || !organisationId?.trim() || !action?.trim() || !['sorted', 'supercharged', 'lms'].includes(applicationId))
            return deny('invalid_principal');
        if (principal.issuer !== this.trust.expectedIssuer)
            return deny('untrusted_issuer');
        if (principal.audience !== this.trust.audienceByApplication[applicationId])
            return deny('untrusted_audience');
        if (!Number.isFinite(Date.parse(principal.verifiedAt)))
            return deny('invalid_principal');
        const identity = await this.repository.identityBySubject(principal.logtoSubject);
        if (!identity || identity.status !== 'active')
            return deny('identity_inactive');
        const org = await this.repository.organisation(organisationId);
        if (!org || org.status !== 'active')
            return deny('organisation_inactive');
        const memberships = (await this.repository.memberships(identity.id, organisationId)).filter((m) => m.status === 'active');
        const membership = oneActive(memberships);
        if (!membership)
            return deny(memberships.length ? 'membership_inactive' : 'membership_missing');
        if (!validExpiry(membership.expiresAt, now))
            return deny('membership_expired');
        const grants = (await this.repository.entitlements(organisationId, applicationId)).filter((e) => e.status === 'active' || e.status === 'trialing');
        const grant = oneActive(grants);
        if (!grant)
            return deny('entitlement_missing');
        if (!validExpiry(grant.expiresAt, now))
            return deny('entitlement_expired');
        if (!getApplication(applicationId).defaultActions[membership.role]?.includes(action))
            return deny('role_denied');
        if (!grant.features.includes(action))
            return deny('feature_denied');
        const links = await this.repository.localLinks(identity.id, organisationId, applicationId);
        if (links.length > 1)
            return deny('link_ambiguous');
        const link = links[0];
        if (!link)
            return deny('link_missing');
        if (link.status !== 'verified')
            return deny('link_unverified');
        if (!link.localUserId || !link.localAccountId)
            return deny('link_unverified');
        return { allowed: true, identityId: identity.id, organisationId, applicationId, localUserId: link.localUserId, localAccountId: link.localAccountId, role: membership.role, membershipRevision: membership.revision, entitlementRevision: grant.revision, linkRevision: link.revision };
    }
}
