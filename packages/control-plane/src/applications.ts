import type { ApplicationId, MembershipRole } from './contracts.js';
export interface ApplicationRegistration {
  id: ApplicationId;
  label: string;
  /** Issued by identity provider per app, never reused between applications. */
  oidcClientIdEnv: string;
  callbackPath: string;
  requiredScopes: readonly string[];
  defaultActions: Readonly<Record<MembershipRole, readonly string[]>>;
}
const common = ['openid', 'profile', 'email'] as const;
const registry: Record<ApplicationId, ApplicationRegistration> = {
  sorted: { id: 'sorted', label: 'Sorted', oidcClientIdEnv: 'TITAN_SORTED_OIDC_CLIENT_ID', callbackPath: '/auth/callback', requiredScopes: common, defaultActions: { owner: ['session:open','clients:read','jobs:read','visits:read','team:read'], admin: ['session:open','clients:read','jobs:read','visits:read','team:read'], manager: ['session:open','clients:read','jobs:read','visits:read'], member: ['session:open','jobs:read','visits:read'], learner: [] } },
  supercharged: { id: 'supercharged', label: 'Supercharged', oidcClientIdEnv: 'TITAN_SUPERCHARGED_OIDC_CLIENT_ID', callbackPath: '/auth/callback', requiredScopes: common, defaultActions: { owner: ['session:open','communications:read','agents:read'], admin: ['session:open','communications:read','agents:read'], manager: ['session:open','communications:read'], member: ['session:open','communications:read'], learner: [] } },
  lms: { id: 'lms', label: 'LMS', oidcClientIdEnv: 'TITAN_LMS_OIDC_CLIENT_ID', callbackPath: '/auth/callback', requiredScopes: common, defaultActions: { owner: ['session:open','courses:read','learners:read','certificates:read'], admin: ['session:open','courses:read','learners:read','certificates:read'], manager: ['session:open','courses:read','learners:read'], member: ['session:open','courses:read','certificates:read'], learner: ['session:open','courses:read','certificates:read'] } },
};
export function getApplication(id: ApplicationId): ApplicationRegistration { return registry[id]; }
export function allApplications(): readonly ApplicationRegistration[] { return Object.values(registry); }
export function makeOidcRedirect(baseUrl: string, appId: ApplicationId): string {
  const url = new URL(baseUrl);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('baseUrl must be a HTTPS origin');
  return `${url.origin}${getApplication(appId).callbackPath}`;
}
