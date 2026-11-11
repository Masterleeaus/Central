/**
 * OIDC route contract (issue #33). ONE path shape for every application:
 *   start:    GET /auth/titan/{applicationId}/start
 *   callback: GET /auth/titan/{applicationId}/callback   (the registered redirect URI, exact match)
 * The Logto registration plan, the login redirect_uri and the control-api adapter mount all
 * derive from these two functions. Do not hand-write these paths anywhere else.
 */
export function oidcStartPath(id) { return `/auth/titan/${id}/start`; }
export function oidcCallbackPath(id) { return `/auth/titan/${id}/callback`; }
const common = ['openid', 'profile', 'email'];
const registry = {
    field: { id: 'field', label: 'Titan Field', oidcClientIdEnv: 'TITAN_FIELD_OIDC_CLIENT_ID', callbackPath: oidcCallbackPath('field'), requiredScopes: common, defaultActions: { owner: ['session:open', 'clients:read', 'jobs:read', 'visits:read', 'team:read'], admin: ['session:open', 'clients:read', 'jobs:read', 'visits:read', 'team:read'], manager: ['session:open', 'clients:read', 'jobs:read', 'visits:read'], member: ['session:open', 'jobs:read', 'visits:read'], learner: [] } },
    desk: { id: 'desk', label: 'Titan Desk', oidcClientIdEnv: 'TITAN_DESK_OIDC_CLIENT_ID', callbackPath: oidcCallbackPath('desk'), requiredScopes: common, defaultActions: { owner: ['session:open', 'communications:read', 'agents:read'], admin: ['session:open', 'communications:read', 'agents:read'], manager: ['session:open', 'communications:read'], member: ['session:open', 'communications:read'], learner: [] } },
    academy: { id: 'academy', label: 'Titan Academy', oidcClientIdEnv: 'TITAN_ACADEMY_OIDC_CLIENT_ID', callbackPath: oidcCallbackPath('academy'), requiredScopes: common, defaultActions: { owner: ['session:open', 'courses:read', 'learners:read', 'certificates:read'], admin: ['session:open', 'courses:read', 'learners:read', 'certificates:read'], manager: ['session:open', 'courses:read', 'learners:read'], member: ['session:open', 'courses:read', 'certificates:read'], learner: ['session:open', 'courses:read', 'certificates:read'] } },
};
export function getApplication(id) { return registry[id]; }
export function allApplications() { return Object.values(registry); }
export function makeOidcRedirect(baseUrl, appId) {
    const url = new URL(baseUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/')
        throw new Error('baseUrl must be a HTTPS origin');
    return `${url.origin}${getApplication(appId).callbackPath}`;
}
