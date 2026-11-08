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
    /** How long a positive membership result may be reused. Default 30s; 0 disables caching.
     * A removed member can therefore still pass a membership check for up to this long. Max 5 minutes. */
    membershipCacheTtlMs?: number;
    /** Upper bound on cached membership entries (oldest evicted first). Default 1000. */
    membershipCacheMaxEntries?: number;
    /** Injectable clock for tests; milliseconds since epoch. */
    clock?: () => number;
}
export declare class LogtoAuthorityError extends Error {
    constructor(message?: string);
}
export declare class LogtoManagementVerifier {
    private readonly origin;
    private readonly accessToken;
    private readonly fetcher;
    private readonly maxPages;
    private readonly membershipTtlMs;
    private readonly membershipMaxEntries;
    private readonly clock;
    /** Key `${organisationId}\0${userId}` -> expiry time (ms). Positive results only, so denials always reach Logto. */
    private readonly membershipCache;
    constructor(opts: LogtoVerifierOptions);
    private get;
    /** Confirm a Logto identity currently belongs to an independently known organisation.
     * A positive result is reused for at most membershipCacheTtlMs; a cache hit costs zero Logto calls.
     * A cold lookup is exactly one bounded Logto call, independent of organisation size; never infer membership from email or profile.
     */
    assertMembership(logtoUserId: string, logtoOrganisationId: string): Promise<void>;
    private rememberMembership;
    /** One Logto call: GET /api/users/{userId}/organizations (upstream logto-io/logto v1.45.0,
     * packages/core/src/routes/admin-user/organization.ts). That endpoint is NOT paginated, so the
     * response is bounded here instead; a missing user returns 404 and is rejected by get(). */
    private lookupMembership;
    assertIdentity(logtoUserId: string): Promise<void>;
    assertOrganisation(logtoOrganisationId: string): Promise<void>;
    /** Require at least one exact Logto organisation role ID, fetched at decision time.
     * Does not infer privileges from email, role display names, or local Desk/Field profiles.
     */
    assertAnyOrganisationRole(logtoUserId: string, logtoOrganisationId: string, allowedRoleIds: readonly string[]): Promise<void>;
}
