function safeOrigin(s) {
    const u = new URL(s);
    if (u.protocol !== 'https:' || u.username || u.password || u.pathname !== '/' || u.search || u.hash || u.port)
        throw Error('invalid application HTTPS origin');
    return u.origin;
}
export function createTitanOidcRegistrationPlans(origins) {
    const apps = ['supercharged', 'sorted', 'lms'];
    const selected = apps.map(app => ({ app, origin: safeOrigin(origins[app]) }));
    if (new Set(selected.map(x => x.origin)).size !== apps.length)
        throw Error('applications require distinct origins');
    return selected.map(({ app, origin }) => ({
        app, origin, redirectUris: [`${origin}/auth/callback`], postLogoutRedirectUris: [`${origin}/`], responseType: 'code', pkce: 'S256', clientType: 'traditional'
    }));
}
