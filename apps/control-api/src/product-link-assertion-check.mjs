/** Product proof check for account links (issue #37). Contract: docs/LINKING.md.
 *
 * Adapts the control-plane LinkAssertionVerifier (the signed compact JWS that Sorted, Supercharged and LMS
 * sign) to the `proofVerifier` slot of createProductAccountLinkWorkflow. It runs every check except the nonce
 * (`check`). The nonce is spent only by the trusted provisioning write (`verify`, via verifyLinkCommand), so
 * a valid assertion is consumed exactly once and a rejected one is never spent here.
 *
 * Fail closed: any rejection, or a missing Central identity or organisation record, returns false.
 * The reason is not returned, so no claim, key or record value reaches the caller.
 */
export function createLinkAssertionProofCheck({ verifier, resolveExpectation } = {}) {
  if (typeof verifier?.check !== 'function' || typeof resolveExpectation !== 'function') {
    throw TypeError('link assertion verifier and expectation resolver required');
  }
  return Object.freeze({
    async verify({ proof, command } = {}) {
      try {
        const scope = await resolveExpectation({ identityId: command?.identityId, organisationId: command?.organisationId });
        if (!scope || typeof scope.logtoSubject !== 'string' || typeof scope.logtoOrganisationId !== 'string') return false;
        await verifier.check(proof, {
          applicationId: command.applicationId,
          logtoSubject: scope.logtoSubject,
          logtoOrganisationId: scope.logtoOrganisationId,
          localUserId: command.localUserId,
          localAccountId: command.localAccountId,
        });
        return true;
      } catch {
        return false;
      }
    },
  });
}
