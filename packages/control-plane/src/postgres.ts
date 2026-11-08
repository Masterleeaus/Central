import type { CentralRepository, Identity, Organisation, Membership, AppEntitlement, LocalAccountLink, ApplicationId } from './contracts.js';

/** Adapter boundary: accepts a node-postgres Pool/PoolClient shaped object without importing pg.
 * All queries are parameterised; never interpolate tenant, identity, or role values into SQL. */
export interface SqlQueryResult { rows: Record<string, unknown>[]; rowCount?: number | null; }
export interface SqlClient { query(text: string, values?: readonly unknown[]): Promise<SqlQueryResult>; release?(): void; }
export interface SqlPool { connect(): Promise<SqlClient>; }

const snake = (row: Record<string, unknown>, key: string): string => String(row[key] ?? '');
function finiteRevision(v: unknown): number { const n = Number(v); if (!Number.isSafeInteger(n) || n < 1) throw new Error('invalid revision'); return n; }
function expiry(v: unknown): string | undefined { if (v === null || v === undefined) return undefined; const d = v instanceof Date ? v : new Date(String(v)); if (!Number.isFinite(d.valueOf())) throw new Error('invalid expiry'); return d.toISOString(); }
function identity(row: Record<string, unknown>): Identity { return { id: snake(row,'id'), logtoSubject: snake(row,'logto_subject'), status: snake(row,'state') as Identity['status'] }; }
function organisation(row: Record<string, unknown>): Organisation { return { id: snake(row,'id'), logtoOrganisationId: snake(row,'logto_organisation_id'), status: snake(row,'state') as Organisation['status'] }; }
function membership(row: Record<string, unknown>): Membership { return { id: snake(row,'id'), identityId: snake(row,'identity_id'), organisationId: snake(row,'organisation_id'), role: snake(row,'role') as Membership['role'], status: snake(row,'state') as Membership['status'], expiresAt: expiry(row['expires_at']), revision: finiteRevision(row['revision']) }; }
function entitlement(row: Record<string, unknown>): AppEntitlement { return { id: snake(row,'id'), organisationId: snake(row,'organisation_id'), applicationId: snake(row,'application_id') as ApplicationId, status: snake(row,'state') as AppEntitlement['status'], features: Array.isArray(row['features']) ? row['features'].map(String) : [], expiresAt: expiry(row['expires_at']), revision: finiteRevision(row['revision']) }; }
function link(row: Record<string, unknown>): LocalAccountLink { return { id: snake(row,'id'), identityId: snake(row,'identity_id'), organisationId: snake(row,'organisation_id'), applicationId: snake(row,'application_id') as ApplicationId, localUserId: snake(row,'local_user_id'), localAccountId: snake(row,'local_account_id'), status: snake(row,'state') as LocalAccountLink['status'], verifiedAt: expiry(row['verified_at']) ?? '', revision: finiteRevision(row['revision']) }; }

/** Reads must be performed using a restricted DB credential. Read-only transactions give
 * a consistent view of membership, entitlement and link revisions per authorisation. */
export class PostgresCentralRepository implements CentralRepository {
  constructor(private readonly sql: SqlClient) {}
  async identityBySubject(subject: string): Promise<Identity | undefined> {
    const r = await this.sql.query('SELECT id, logto_subject, state FROM titan.identities WHERE logto_subject=$1 LIMIT 2',[subject]);
    if (r.rows.length > 1) throw new Error('ambiguous identity');
    return r.rows[0] && identity(r.rows[0]);
  }
  async organisation(id: string): Promise<Organisation | undefined> {
    const r= await this.sql.query('SELECT id, logto_organisation_id, state FROM titan.organisations WHERE id=$1 LIMIT 2',[id]);
    if(r.rows.length>1) throw new Error('ambiguous organisation');
    return r.rows[0] && organisation(r.rows[0]);
  }
  async memberships(identityId: string, organisationId: string): Promise<readonly Membership[]> {
    const r=await this.sql.query('SELECT id, identity_id, organisation_id, role, state, expires_at, revision FROM titan.memberships WHERE identity_id=$1 AND organisation_id=$2',[identityId,organisationId]);
    return r.rows.map(membership);
  }
  async entitlements(organisationId: string, applicationId: ApplicationId): Promise<readonly AppEntitlement[]> {
    const r=await this.sql.query('SELECT id, organisation_id, application_id, state, features, expires_at, revision FROM titan.entitlements WHERE organisation_id=$1 AND application_id=$2',[organisationId,applicationId]);
    return r.rows.map(entitlement);
  }
  async localLinks(identityId: string, organisationId: string, applicationId: ApplicationId): Promise<readonly LocalAccountLink[]> {
    const r=await this.sql.query('SELECT id, identity_id, organisation_id, application_id, local_user_id, local_account_id, state, verified_at, revision FROM titan.local_account_links WHERE identity_id=$1 AND organisation_id=$2 AND application_id=$3',[identityId,organisationId,applicationId]);
    return r.rows.map(link);
  }
}

/** Every access decision must use one connection and one snapshot; no concurrent pool queries. */
export async function withCentralReadSnapshot<T>(pool: SqlPool, task: (repo: PostgresCentralRepository) => Promise<T>): Promise<T> {
  const conn=await pool.connect(); let begun=false;
  try {
    await conn.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'); begun=true;
    await conn.query("SET LOCAL statement_timeout = '5000ms'");
    const result=await task(new PostgresCentralRepository(conn));
    await conn.query('COMMIT'); begun=false;
    return result;
  } catch (error) {
    if (begun) { try { await conn.query('ROLLBACK'); } catch { /* original error remains authoritative */ } }
    throw error;
  } finally { conn.release?.(); }
}

export type MemberState = 'active' | 'invited' | 'suspended' | 'revoked';
export type GrantState = 'active' | 'trialing' | 'paused' | 'expired' | 'revoked';

/** Mutation boundary: caller must have been independently authenticated and authorised.
 * Optimistic revision checks ensure concurrent changes fail closed. */
export class CentralMutationStore {
  constructor(private readonly pool: SqlPool) {}
  private async update(query: string, params: readonly unknown[]): Promise<boolean> {
    const conn=await this.pool.connect();
    try { const r=await conn.query(query,params); return r.rowCount === 1; }
    finally { conn.release?.(); }
  }
  async setMembershipState(id: string, expectedRevision: number, state: MemberState): Promise<boolean> {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision<1 || !['active','invited','suspended','revoked'].includes(state)) throw new Error('invalid membership mutation');
    return this.update('UPDATE titan.memberships SET state=$3, revision=revision+1 WHERE id=$1 AND revision=$2 AND state<>$3',[id,expectedRevision,state]);
  }
  async setEntitlementState(id: string, expectedRevision: number, state: GrantState): Promise<boolean> {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision<1 || !['active','trialing','paused','expired','revoked'].includes(state)) throw new Error('invalid entitlement mutation');
    return this.update('UPDATE titan.entitlements SET state=$3, revision=revision+1 WHERE id=$1 AND revision=$2 AND state<>$3',[id,expectedRevision,state]);
  }
  async revokeLocalLink(id: string, expectedRevision: number): Promise<boolean> {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision<1) throw new Error('invalid link revision');
    return this.update("UPDATE titan.local_account_links SET state='revoked', revision=revision+1 WHERE id=$1 AND revision=$2 AND state='verified'",[id,expectedRevision]);
  }
}
