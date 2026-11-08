const identifier = (v) => typeof v === 'string' && v.length > 0 && v.length <= 256 && /^[A-Za-z0-9_-]+$/.test(v);
const obj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
export class LogtoAuthorityError extends Error {
    constructor(message = 'Logto authority verification failed') { super(message); this.name = 'LogtoAuthorityError'; }
}
export class LogtoManagementVerifier {
    origin;
    accessToken;
    fetcher;
    maxPages;
    constructor(opts) {
        const url = new URL(opts.origin);
        if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/')
            throw new Error('management origin must be an HTTPS origin');
        if (!Number.isInteger(opts.maxPages ?? 25) || (opts.maxPages ?? 25) < 1 || (opts.maxPages ?? 25) > 100)
            throw new Error('invalid page bound');
        this.origin = url.origin;
        this.accessToken = opts.accessToken;
        this.fetcher = opts.fetcher ?? fetch;
        this.maxPages = opts.maxPages ?? 25;
    }
    async get(path) {
        const token = await this.accessToken();
        if (typeof token !== 'string' || token.length < 12 || token.length > 16384 || /[\r\n]/.test(token))
            throw new LogtoAuthorityError('invalid management credential');
        let response;
        try {
            response = await this.fetcher(`${this.origin}/api${path}`, { method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(5000) });
        }
        catch {
            throw new LogtoAuthorityError('management request unavailable');
        }
        if (!response.ok)
            throw new LogtoAuthorityError('management request rejected');
        try {
            return await response.json();
        }
        catch {
            throw new LogtoAuthorityError('invalid management response');
        }
    }
    /** Confirm a Logto identity currently belongs to an independently known organisation.
     * Exhaust pages (up to a configured safe bound); never infer membership from email or profile.
     */
    async assertMembership(logtoUserId, logtoOrganisationId) {
        if (!identifier(logtoUserId) || !identifier(logtoOrganisationId))
            throw new LogtoAuthorityError('invalid identity reference');
        const user = await this.get(`/users/${encodeURIComponent(logtoUserId)}`);
        const organisation = await this.get(`/organizations/${encodeURIComponent(logtoOrganisationId)}`);
        if (!obj(user) || user.id !== logtoUserId || !obj(organisation) || organisation.id !== logtoOrganisationId)
            throw new LogtoAuthorityError('identity or organisation not found');
        for (let page = 1; page <= this.maxPages; page++) {
            const members = await this.get(`/organizations/${encodeURIComponent(logtoOrganisationId)}/users?page=${page}&page_size=100`);
            if (!Array.isArray(members) || members.length > 100 || !members.every(x => obj(x) && identifier(x.id)))
                throw new LogtoAuthorityError('invalid organisation membership response');
            if (members.some(x => x.id === logtoUserId))
                return;
            if (members.length < 100)
                throw new LogtoAuthorityError('user not a current organisation member');
        }
        throw new LogtoAuthorityError('membership lookup exceeded safe pagination bound');
    }
    async assertIdentity(logtoUserId) {
        if (!identifier(logtoUserId))
            throw new LogtoAuthorityError('invalid user reference');
        const user = await this.get(`/users/${encodeURIComponent(logtoUserId)}`);
        if (!obj(user) || user.id !== logtoUserId)
            throw new LogtoAuthorityError('user not found');
    }
    async assertOrganisation(logtoOrganisationId) {
        if (!identifier(logtoOrganisationId))
            throw new LogtoAuthorityError('invalid organisation reference');
        const org = await this.get(`/organizations/${encodeURIComponent(logtoOrganisationId)}`);
        if (!obj(org) || org.id !== logtoOrganisationId)
            throw new LogtoAuthorityError('organisation not found');
    }
    /** Require at least one exact Logto organisation role ID, fetched at decision time.
     * Does not infer privileges from email, role display names, or local Desk/Field profiles.
     */
    async assertAnyOrganisationRole(logtoUserId, logtoOrganisationId, allowedRoleIds) {
        if (!identifier(logtoUserId) || !identifier(logtoOrganisationId) || !Array.isArray(allowedRoleIds) || allowedRoleIds.length < 1 || allowedRoleIds.length > 32 || !allowedRoleIds.every(identifier))
            throw new LogtoAuthorityError('invalid organisation role scope');
        const allowed = new Set(allowedRoleIds);
        // Membership is independently rechecked at the time of each privileged decision.
        await this.assertMembership(logtoUserId, logtoOrganisationId);
        for (let page = 1; page <= this.maxPages; page++) {
            const raw = await this.get(`/organizations/${encodeURIComponent(logtoOrganisationId)}/users/${encodeURIComponent(logtoUserId)}/roles?page=${page}&page_size=100`);
            if (!Array.isArray(raw) || raw.length > 100 || !raw.every(role => obj(role) && identifier(role.id)))
                throw new LogtoAuthorityError('invalid organisation roles response');
            if (raw.some(role => obj(role) && typeof role.id === 'string' && allowed.has(role.id)))
                return;
            if (raw.length < 100)
                throw new LogtoAuthorityError('administrator role not held');
        }
        throw new LogtoAuthorityError('organisation role lookup exceeded safe bound');
    }
}
