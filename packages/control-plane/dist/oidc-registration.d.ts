/** Exact, operator-reviewed OIDC client registration plans. No management mutations.
 * Client IDs are assigned by running Logto, not guessed or seeded by the browser.
 */
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
