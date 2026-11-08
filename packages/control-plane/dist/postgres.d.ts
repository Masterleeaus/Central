import type { CentralRepository, Identity, Organisation, Membership, AppEntitlement, LocalAccountLink, ApplicationId } from './contracts.js';
/** Adapter boundary: accepts a node-postgres Pool/PoolClient shaped object without importing pg.
 * All queries are parameterised; never interpolate tenant, identity, or role values into SQL. */
export interface SqlQueryResult {
    rows: Record<string, unknown>[];
    rowCount?: number | null;
}
export interface SqlClient {
    query(text: string, values?: readonly unknown[]): Promise<SqlQueryResult>;
    release?(): void;
}
export interface SqlPool {
    connect(): Promise<SqlClient>;
}
/** Reads must be performed using a restricted DB credential. Read-only transactions give
 * a consistent view of membership, entitlement and link revisions per authorisation. */
export declare class PostgresCentralRepository implements CentralRepository {
    private readonly sql;
    constructor(sql: SqlClient);
    identityBySubject(subject: string): Promise<Identity | undefined>;
    organisation(id: string): Promise<Organisation | undefined>;
    memberships(identityId: string, organisationId: string): Promise<readonly Membership[]>;
    entitlements(organisationId: string, applicationId: ApplicationId): Promise<readonly AppEntitlement[]>;
    localLinks(identityId: string, organisationId: string, applicationId: ApplicationId): Promise<readonly LocalAccountLink[]>;
}
/** Every access decision must use one connection and one snapshot; no concurrent pool queries. */
export declare function withCentralReadSnapshot<T>(pool: SqlPool, task: (repo: PostgresCentralRepository) => Promise<T>): Promise<T>;
export type MemberState = 'active' | 'invited' | 'suspended' | 'revoked';
export type GrantState = 'active' | 'trialing' | 'paused' | 'expired' | 'revoked';
/** Mutations are not exposed here. Use CentralProvisioner (provisioning.ts), which writes the
 * row change, the session revocation generation and the audit record in one transaction. */
