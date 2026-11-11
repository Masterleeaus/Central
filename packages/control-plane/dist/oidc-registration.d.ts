/** Callback contract: see oidcCallbackPath in applications.ts (/auth/titan/{app}/callback). */
export type TitanApp = 'desk' | 'field' | 'academy';
export interface OidcApplicationPlan {
    app: TitanApp;
    origin: string;
    redirectUris: readonly string[];
    postLogoutRedirectUris: readonly string[];
    responseType: 'code';
    pkce: 'S256';
    /** Backend confidential clients must keep their client secret on server. */
    clientType: 'traditional';
}
export declare function createTitanOidcRegistrationPlans(origins: Record<TitanApp, string>): readonly OidcApplicationPlan[];
