export class LogtoMachineError extends Error {
    constructor(message = 'Logto machine token unavailable') { super(message); this.name = 'LogtoMachineError'; }
}
const required = (s) => typeof s === 'string' && s.length > 0 && s.length <= 2048 && !/[\r\n\0]/.test(s);
const originOf = (s) => {
    let u;
    try {
        u = new URL(s);
    }
    catch {
        throw new Error('invalid Logto issuer origin');
    }
    if (u.protocol !== 'https:' || u.username || u.password || u.pathname !== '/' || u.search || u.hash)
        throw new Error('Logto issuer must be an HTTPS origin');
    return u.origin;
};
export class LogtoMachineTokenClient {
    origin;
    opts;
    fetcher;
    clock;
    skew;
    cached;
    pending;
    constructor(opts) {
        this.origin = originOf(opts.issuerOrigin);
        for (const key of ['clientId', 'clientSecret', 'resource', 'scope']) {
            if (!required(opts[key]))
                throw new Error(`invalid ${key}`);
        }
        if (!/^https:\/\//.test(opts.resource))
            throw new Error('resource must be HTTPS');
        if (!/^[A-Za-z0-9:_./*-]+(?: [A-Za-z0-9:_./*-]+)*$/.test(opts.scope))
            throw new Error('invalid scope');
        this.opts = opts;
        this.fetcher = opts.fetcher ?? fetch;
        this.clock = opts.clock ?? Date.now;
        this.skew = opts.refreshSkewMs ?? 30000;
        if (!Number.isFinite(this.skew) || this.skew < 0 || this.skew > 120000)
            throw new Error('invalid refresh skew');
    }
    async accessToken() {
        if (this.cached && this.cached.expiresAt - this.skew > this.clock())
            return this.cached.token;
        if (this.pending)
            return this.pending;
        this.pending = this.acquire().finally(() => { this.pending = undefined; });
        return this.pending;
    }
    invalidate() { this.cached = undefined; }
    async acquire() {
        const form = new URLSearchParams({ grant_type: 'client_credentials', resource: this.opts.resource, scope: this.opts.scope });
        let response;
        try {
            response = await this.fetcher(`${this.origin}/oidc/token`, {
                method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json', authorization: `Basic ${Buffer.from(`${this.opts.clientId}:${this.opts.clientSecret}`, 'utf8').toString('base64')}` },
                body: form.toString(), redirect: 'error', signal: AbortSignal.timeout(5000)
            });
        }
        catch {
            throw new LogtoMachineError();
        }
        if (!response.ok)
            throw new LogtoMachineError();
        let token;
        try {
            token = await response.json();
        }
        catch {
            throw new LogtoMachineError();
        }
        if (!token || typeof token !== 'object')
            throw new LogtoMachineError();
        const payload = token;
        if (!required(payload.access_token) || payload.access_token.length < 12 || payload.access_token.length > 16384 || payload.token_type !== 'Bearer' || typeof payload.expires_in !== 'number' || !Number.isFinite(payload.expires_in) || payload.expires_in <= 0 || payload.expires_in > 86400)
            throw new LogtoMachineError();
        const expiry = this.clock() + Math.floor(payload.expires_in * 1000);
        this.cached = { token: payload.access_token, expiresAt: expiry };
        return payload.access_token;
    }
}
/** Wire the callback to LogtoManagementVerifier without exposing secrets. */
export const createLogtoManagementTokenSupplier = (opts) => {
    const client = new LogtoMachineTokenClient(opts);
    return { origin: client.origin, accessToken: () => client.accessToken(), invalidate: () => client.invalidate() };
};
