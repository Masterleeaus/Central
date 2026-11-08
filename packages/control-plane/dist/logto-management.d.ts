/** Trusted, server-only Logto Management API verification boundary.
 * A valid machine-to-machine Management API token must be supplied by an approved backend,
 * NEVER an end-user bearer token or browser header. No mutations are performed here.
 */
export interface LogtoVerifierOptions {
    /** Fixed server administrator-configured Management API origin, not user input. */
    origin: string;
    /** Return a short-lived Management API access token obtained with client credentials. */
    accessToken: () => Promise<string>;
    fetcher?: typeof fetch;
    maxPages?: number;
}
export declare class LogtoAuthorityError extends Error {
    constructor(message?: string);
}
export declare class LogtoManagementVerifier {
    private readonly origin;
    private readonly accessToken;
    private readonly fetcher;
    private readonly maxPages;
    constructor(opts: LogtoVerifierOptions);
    private get;
    /** Confirm a Logto identity currently belongs to an independently known organisation.
     * Exhaust pages (up to a configured safe bound); never infer membership from email or profile.
     */
    assertMembership(logtoUserId: string, logtoOrganisationId: string): Promise<void>;
    assertIdentity(logtoUserId: string): Promise<void>;
    assertOrganisation(logtoOrganisationId: string): Promise<void>;
    /** Require at least one exact Logto organisation role ID, fetched at decision time.
     * Does not infer privileges from email, role display names, or local Supercharged/Sorted profiles.
     */
    assertAnyOrganisationRole(logtoUserId: string, logtoOrganisationId: string, allowedRoleIds: readonly string[]): Promise<void>;
}
