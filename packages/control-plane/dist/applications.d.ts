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
export declare function getApplication(id: ApplicationId): ApplicationRegistration;
export declare function allApplications(): readonly ApplicationRegistration[];
export declare function makeOidcRedirect(baseUrl: string, appId: ApplicationId): string;
