export class TrustedProvisioningService {
    provisioner;
    logto;
    authorize;
    resolve;
    verifyLocalLink;
    constructor(provisioner, logto, authorize, resolve, verifyLocalLink) {
        this.provisioner = provisioner;
        this.logto = logto;
        this.authorize = authorize;
        this.resolve = resolve;
        this.verifyLocalLink = verifyLocalLink;
    }
    async apply(actor, context, command) {
        if (!actor || actor.managementCredentialVerified !== true || !actor.logtoSubject || actor.logtoSubject !== context.actorSubject)
            throw Error('unverified provisioning actor');
        // Authorize before querying management services or writing SQL. Fail closed by default.
        if (await this.authorize(actor, command) !== true)
            throw Error('provisioning forbidden');
        switch (command.kind) {
            case 'identity':
                await this.logto.assertIdentity(command.logtoSubject);
                break;
            case 'organisation':
                await this.logto.assertOrganisation(command.logtoOrganisationId);
                break;
            case 'membership': {
                const user = await this.resolve('identity', command.identityId);
                const org = await this.resolve('organisation', command.organisationId);
                if (!user || !org)
                    throw Error('unverified canonical identity or organisation');
                await this.logto.assertMembership(user, org);
                break;
            }
            case 'entitlement': {
                const org = await this.resolve('organisation', command.organisationId);
                if (!org)
                    throw Error('unverified organisation');
                await this.logto.assertOrganisation(org);
                break;
            }
            case 'link': {
                const user = await this.resolve('identity', command.identityId);
                const org = await this.resolve('organisation', command.organisationId);
                if (!user || !org)
                    throw Error('unverified canonical identity or organisation');
                await this.logto.assertMembership(user, org);
                if (await this.verifyLocalLink(command) !== true)
                    throw Error('unverified application account control');
                break;
            }
            // Reductions (suspend, demote, revoke) must still succeed after Logto has removed the
            // membership, so no live Logto membership check applies. The organisation must still
            // resolve canonically; the authorize policy above is the control for the row itself.
            case 'membership_update':
            case 'entitlement_update':
            case 'link_revoke': {
                const org = await this.resolve('organisation', command.organisationId);
                if (!org)
                    throw Error('unverified organisation');
                break;
            }
            default: throw Error('unsupported provisioning');
        }
        return this.provisioner.apply(context, command);
    }
}
