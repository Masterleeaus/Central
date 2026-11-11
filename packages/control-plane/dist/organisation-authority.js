import { LogtoAuthorityError } from './logto-management.js';
const validId = (value) => typeof value === 'string' && value.length > 0 && value.length <= 256 && /^[A-Za-z0-9_-]+$/.test(value);
export function createOrganisationProvisioningAuthorizer(opts) {
    const roles = opts.administrativeRoleIds;
    if (!Array.isArray(roles) || roles.length === 0 || roles.length > 32 || roles.some(id => !validId(id)) || new Set(roles).size !== roles.length)
        throw new Error('explicit Logto administrator role IDs are required');
    return async (actor, command) => {
        if (!validId(actor?.logtoSubject) || actor.operatorAuthorityVerified !== true)
            return false;
        // Creating canonical user/org identities requires a separate platform provisioning authority.
        // It must never be granted implicitly merely because someone is an org administrator.
        if (command.kind === 'identity' || command.kind === 'organisation')
            return false;
        const organisationId = await opts.resolve('organisation', command.organisationId);
        if (!validId(organisationId))
            return false;
        try {
            await opts.verifier.assertMembership(actor.logtoSubject, organisationId);
            await opts.verifier.assertAnyOrganisationRole(actor.logtoSubject, organisationId, roles);
            return true;
        }
        catch (e) {
            if (e instanceof LogtoAuthorityError)
                return false;
            throw e; // infrastructure failure remains fail-closed via rejection
        }
    };
}
