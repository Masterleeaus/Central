const snake = (row, key) => String(row[key] ?? '');
function finiteRevision(v) { const n = Number(v); if (!Number.isSafeInteger(n) || n < 1)
    throw new Error('invalid revision'); return n; }
function expiry(v) { if (v === null || v === undefined)
    return undefined; const d = v instanceof Date ? v : new Date(String(v)); if (!Number.isFinite(d.valueOf()))
    throw new Error('invalid expiry'); return d.toISOString(); }
function identity(row) { return { id: snake(row, 'id'), logtoSubject: snake(row, 'logto_subject'), status: snake(row, 'state') }; }
function organisation(row) { return { id: snake(row, 'id'), logtoOrganisationId: snake(row, 'logto_organisation_id'), status: snake(row, 'state') }; }
function membership(row) { return { id: snake(row, 'id'), identityId: snake(row, 'identity_id'), organisationId: snake(row, 'organisation_id'), role: snake(row, 'role'), status: snake(row, 'state'), expiresAt: expiry(row['expires_at']), revision: finiteRevision(row['revision']) }; }
function entitlement(row) { return { id: snake(row, 'id'), organisationId: snake(row, 'organisation_id'), applicationId: snake(row, 'application_id'), status: snake(row, 'state'), features: Array.isArray(row['features']) ? row['features'].map(String) : [], expiresAt: expiry(row['expires_at']), revision: finiteRevision(row['revision']) }; }
function link(row) { return { id: snake(row, 'id'), identityId: snake(row, 'identity_id'), organisationId: snake(row, 'organisation_id'), applicationId: snake(row, 'application_id'), localUserId: snake(row, 'local_user_id'), localAccountId: snake(row, 'local_account_id'), status: snake(row, 'state'), verifiedAt: expiry(row['verified_at']) ?? '', revision: finiteRevision(row['revision']) }; }
/** Reads must be performed using a restricted DB credential. Read-only transactions give
 * a consistent view of membership, entitlement and link revisions per authorisation. */
export class PostgresCentralRepository {
    sql;
    constructor(sql) {
        this.sql = sql;
    }
    async identityBySubject(subject) {
        const r = await this.sql.query('SELECT id, logto_subject, state FROM titan.identities WHERE logto_subject=$1 LIMIT 2', [subject]);
        if (r.rows.length > 1)
            throw new Error('ambiguous identity');
        return r.rows[0] && identity(r.rows[0]);
    }
    async organisation(id) {
        const r = await this.sql.query('SELECT id, logto_organisation_id, state FROM titan.organisations WHERE id=$1 LIMIT 2', [id]);
        if (r.rows.length > 1)
            throw new Error('ambiguous organisation');
        return r.rows[0] && organisation(r.rows[0]);
    }
    async memberships(identityId, organisationId) {
        const r = await this.sql.query('SELECT id, identity_id, organisation_id, role, state, expires_at, revision FROM titan.memberships WHERE identity_id=$1 AND organisation_id=$2', [identityId, organisationId]);
        return r.rows.map(membership);
    }
    async entitlements(organisationId, applicationId) {
        const r = await this.sql.query('SELECT id, organisation_id, application_id, state, features, expires_at, revision FROM titan.entitlements WHERE organisation_id=$1 AND application_id=$2', [organisationId, applicationId]);
        return r.rows.map(entitlement);
    }
    async localLinks(identityId, organisationId, applicationId) {
        const r = await this.sql.query('SELECT id, identity_id, organisation_id, application_id, local_user_id, local_account_id, state, verified_at, revision FROM titan.local_account_links WHERE identity_id=$1 AND organisation_id=$2 AND application_id=$3', [identityId, organisationId, applicationId]);
        return r.rows.map(link);
    }
}
const UUID_TEXT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Every access decision must use one connection and one snapshot; no concurrent pool queries.
 * The transaction runs as titan_trusted_reader (SET LOCAL ROLE; the login role must be a member but
 * does not inherit its privileges) and is scoped to one organisation for the row-level security
 * policies in migrations 0006 and 0008. The organisation is a bound parameter: SET LOCAL cannot take
 * one, so set_config(name, value, true) is used, which has the same transaction-local effect.
 * Both settings end with the transaction, so a pooled connection never keeps the scope. */
export async function withCentralReadSnapshot(pool, organisationId, task) {
    return withTenantReadScope(pool, organisationId, conn => task(new PostgresCentralRepository(conn)));
}
/** Runs one read-only snapshot as titan_trusted_reader scoped to one organisation (see withCentralReadSnapshot). */
export async function withTenantReadScope(pool, organisationId, task) {
    if (typeof organisationId !== 'string' || !UUID_TEXT.test(organisationId))
        throw new Error('organisation scope required');
    const conn = await pool.connect();
    let begun = false;
    try {
        await conn.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
        begun = true;
        await conn.query('SET LOCAL ROLE titan_trusted_reader');
        await conn.query("SELECT set_config('titan.organisation_id', $1, true)", [organisationId]);
        await conn.query("SET LOCAL statement_timeout = '5000ms'");
        const result = await task(conn);
        await conn.query('COMMIT');
        begun = false;
        return result;
    }
    catch (error) {
        if (begun) {
            try {
                await conn.query('ROLLBACK');
            }
            catch { /* original error remains authoritative */ }
        }
        throw error;
    }
    finally {
        conn.release?.();
    }
}
/** Mutations are not exposed here. Use CentralProvisioner (provisioning.ts), which writes the
 * row change, the session revocation generation and the audit record in one transaction. */
