export function linkFromVerifiedAssertion(id, assertion, now) {
    if (!id.trim() || !assertion.identityId?.trim() || !assertion.organisationId?.trim() || !assertion.localUserId?.trim() || !assertion.localAccountId?.trim() || !assertion.verifiedBy?.trim() || !Number.isFinite(Date.parse(assertion.assertedAt)) || !Number.isFinite(Date.parse(now)))
        throw new Error('Invalid verified link assertion');
    if (Date.parse(assertion.assertedAt) > Date.parse(now) + 30_000 || Date.parse(assertion.assertedAt) < Date.parse(now) - 300_000)
        throw new Error('Stale verified assertion');
    return { id, identityId: assertion.identityId, organisationId: assertion.organisationId, applicationId: assertion.applicationId, localUserId: assertion.localUserId, localAccountId: assertion.localAccountId, status: 'verified', verifiedAt: now, revision: 1 };
}
