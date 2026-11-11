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
/**
 * OIDC route contract (issue #33). ONE path shape for every application:
 *   start:    GET /auth/titan/{applicationId}/start
 *   callback: GET /auth/titan/{applicationId}/callback   (the registered redirect URI, exact match)
 * The Logto registration plan, the login redirect_uri and the control-api adapter mount all
 * derive from these two functions. Do not hand-write these paths anywhere else.
 */
export declare function oidcStartPath(id: ApplicationId): string;
export declare function oidcCallbackPath(id: ApplicationId): string;
export declare function getApplication(id: ApplicationId): ApplicationRegistration;
export declare function allApplications(): readonly ApplicationRegistration[];
export declare function makeOidcRedirect(baseUrl: string, appId: ApplicationId): string;
