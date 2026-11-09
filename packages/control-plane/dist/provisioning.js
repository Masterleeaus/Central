const uuid = (v) => typeof v === 'string' && /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(v);
const nonempty = (s, max = 256) => typeof s === 'string' && s.length > 0 && s.length <= max && s.trim() === s && !/[\x00-\x1f\x7f]/.test(s);
const revision = (v) => Number.isSafeInteger(v) && v >= 1;
const roles = new Set(['owner', 'admin', 'manager', 'member', 'learner']);
const apps = new Set(['field', 'desk', 'academy']);
const memberStates = new Set(['active', 'invited', 'suspended', 'revoked']);
const grantStates = new Set(['active', 'trialing', 'paused', 'expired', 'revoked']);
/** Role rank used only to detect demotion; higher is more privileged. */
const ROLE_RANK = { learner: 0, member: 1, manager: 2, admin: 3, owner: 4 };
/** Every application whose sessions must be revoked when a member's access is reduced. */
const SESSION_APPS = ['desk', 'field', 'academy'];
const validDate = (d) => !d || (Number.isFinite(Date.parse(d)) && new Date(d).toISOString() === d);
const validFeatures = (f) => Array.isArray(f) && f.length <= 100 && f.every(x => nonempty(x, 100)) && new Set(f).size === f.length;
const isoOrNull = (v) => { if (v === null || v === undefined)
    return null; const d = new Date(v); if (!Number.isFinite(d.valueOf()))
    throw Error('invalid stored expiry'); return d.toISOString(); };
const isCreate = (c) => c.kind === 'identity' || c.kind === 'organisation' || c.kind === 'membership' || c.kind === 'entitlement' || c.kind === 'link';
function validate(c, context) {
    if (!uuid(context.requestId) || !nonempty(context.actorSubject) || !nonempty(context.authorityReference, 500))
        throw Error('invalid provisioning authority context');
    if (!uuid(c.id))
        throw Error('invalid provisioning identifier');
    switch (c.kind) {
        case 'identity':
            if (!nonempty(c.logtoSubject))
                throw Error('invalid identity subject');
            break;
        case 'organisation':
            if (!nonempty(c.logtoOrganisationId))
                throw Error('invalid organisation subject');
            break;
        case 'membership':
            if (!uuid(c.identityId) || !uuid(c.organisationId) || !roles.has(c.role))
                throw Error('invalid membership');
            break;
        case 'entitlement':
            if (!uuid(c.organisationId) || !apps.has(c.applicationId) || !Array.isArray(c.features) || c.features.length > 100 || !c.features.every(f => nonempty(f, 100)) || new Set(c.features).size !== c.features.length || !validDate(c.expiresAt))
                throw Error('invalid entitlement');
            break;
        case 'link':
            if (!uuid(c.identityId) || !uuid(c.organisationId) || !apps.has(c.applicationId) || !nonempty(c.localUserId) || !nonempty(c.localAccountId) || (!nonempty(c.verifiedAt) || !validDate(c.verifiedAt)))
                throw Error('invalid account link');
            break;
        case 'membership_update':
            if (!uuid(c.organisationId) || !revision(c.expectedRevision) || (c.role === undefined && c.state === undefined) || (c.role !== undefined && !roles.has(c.role)) || (c.state !== undefined && !memberStates.has(c.state)))
                throw Error('invalid membership update');
            break;
        case 'entitlement_update':
            if (!uuid(c.organisationId) || !revision(c.expectedRevision) || !grantStates.has(c.state))
                throw Error('invalid entitlement update');
            if (c.features !== undefined && !validFeatures(c.features))
                throw Error('invalid entitlement update');
            if (c.expiresAt !== undefined && c.expiresAt !== null && !(typeof c.expiresAt === 'string' && validDate(c.expiresAt)))
                throw Error('invalid entitlement update');
            break;
        case 'link_revoke':
            if (!uuid(c.organisationId) || !revision(c.expectedRevision))
                throw Error('invalid link revocation');
            break;
        default: throw Error('unsupported provisioning command');
    }
}
/** Exactly one transaction and one audit event per idempotency key.
 * Conflicts never mutate another identity's mapping. Replays return the original result.
 * Reductions of access (suspend, demote, revoke) bump the session revocation generation
 * in the same transaction as the row change and the audit record.
 */
export class CentralProvisioner {
    pool;
    constructor(pool) {
        this.pool = pool;
    }
    async apply(context, command) {
        validate(command, context);
        const conn = await this.pool.connect();
        let begun = false;
        try {
            await conn.query('BEGIN');
            begun = true;
            // Cross-tenant writes run only as titan_trusted_writer (migrations 0006-0008); the login role does not inherit them.
            await conn.query('SET LOCAL ROLE titan_trusted_writer');
            await conn.query("SET LOCAL statement_timeout = '5000ms'");
            // Serialize the exact request ID; request idempotence is protected by the DB unique constraint.
            await conn.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [context.requestId]);
            const previous = await conn.query('SELECT command_kind, command_digest FROM titan.provisioning_audit WHERE request_id=$1', [context.requestId]);
            const digest = stableDigest(command);
            if (previous.rows.length) {
                if (previous.rows.length !== 1 || previous.rows[0].command_kind !== command.kind || previous.rows[0].command_digest !== digest)
                    throw Error('provisioning request ID reused with different payload');
                await conn.query('COMMIT');
                begun = false;
                return 'replayed';
            }
            const outcome = isCreate(command) ? (await insertProvisioning(conn, command), 'created') : (await applyUpdate(conn, command), 'updated');
            await conn.query('INSERT INTO titan.provisioning_audit(request_id,actor_subject,authority_reference,command_kind,command_digest,subject_id) VALUES ($1,$2,$3,$4,$5,$6)', [context.requestId, context.actorSubject, context.authorityReference, command.kind, digest, command.id]);
            await conn.query('COMMIT');
            begun = false;
            return outcome;
        }
        catch (e) {
            if (begun) {
                try {
                    await conn.query('ROLLBACK');
                }
                catch { /* retain original exception */ }
            }
            throw e;
        }
        finally {
            conn.release?.();
        }
    }
}
/** Consistent serialized payload for replay detection; no cryptographic claims: stored audit text is not a signature. */
function stableDigest(command) {
    const sorted = Object.fromEntries(Object.entries(command).sort(([a], [b]) => a.localeCompare(b)));
    return JSON.stringify(sorted);
}
async function insertProvisioning(conn, c) {
    let result;
    switch (c.kind) {
        case 'identity':
            result = await conn.query("INSERT INTO titan.identities (id,logto_subject,state) VALUES ($1,$2,'active') ON CONFLICT DO NOTHING RETURNING id", [c.id, c.logtoSubject]);
            break;
        case 'organisation':
            result = await conn.query("INSERT INTO titan.organisations (id,logto_organisation_id,state) VALUES ($1,$2,'active') ON CONFLICT DO NOTHING RETURNING id", [c.id, c.logtoOrganisationId]);
            break;
        case 'membership':
            result = await conn.query("INSERT INTO titan.memberships(id,identity_id,organisation_id,role,state) VALUES ($1,$2,$3,$4,'active') ON CONFLICT DO NOTHING RETURNING id", [c.id, c.identityId, c.organisationId, c.role]);
            break;
        case 'entitlement':
            result = await conn.query("INSERT INTO titan.entitlements(id,organisation_id,application_id,state,features,expires_at) VALUES ($1,$2,$3,'active',$4,$5) ON CONFLICT DO NOTHING RETURNING id", [c.id, c.organisationId, c.applicationId, c.features, c.expiresAt ?? null]);
            break;
        case 'link':
            result = await conn.query("INSERT INTO titan.local_account_links(id,identity_id,organisation_id,application_id,local_user_id,local_account_id,state,verified_at) VALUES ($1,$2,$3,$4,$5,$6,'verified',$7) ON CONFLICT DO NOTHING RETURNING id", [c.id, c.identityId, c.organisationId, c.applicationId, c.localUserId, c.localAccountId, c.verifiedAt]);
            break;
    }
    if (result?.rowCount !== 1)
        throw Error('provisioning conflict: existing record requires explicit review');
}
/** Update and revoke commands. Each row is locked with FOR UPDATE, the expected revision is
 * compared, and the revision is advanced by the same statement that changes the state. */
async function applyUpdate(conn, c) {
    switch (c.kind) {
        case 'membership_update': {
            const locked = await conn.query('SELECT m.organisation_id, m.role, m.state, m.revision, i.logto_subject FROM titan.memberships m JOIN titan.identities i ON i.id=m.identity_id WHERE m.id=$1 FOR UPDATE OF m', [c.id]);
            const current = locked.rows[0];
            if (!current || Number(current.revision) !== c.expectedRevision)
                throw Error('revision conflict: membership missing or changed');
            if (String(current.organisation_id) !== c.organisationId)
                throw Error('organisation mismatch: membership belongs to another organisation');
            const currentRole = String(current.role);
            const nextRole = c.role ?? currentRole;
            const nextState = c.state ?? String(current.state);
            const updated = await conn.query('UPDATE titan.memberships SET role=$3, state=$4, revision=revision+1 WHERE id=$1 AND revision=$2', [c.id, c.expectedRevision, nextRole, nextState]);
            if (updated.rowCount !== 1)
                throw Error('revision conflict: membership changed');
            const reduced = nextState !== 'active' || ROLE_RANK[nextRole] < ROLE_RANK[currentRole];
            if (reduced)
                for (const app of SESSION_APPS)
                    await bumpGeneration(conn, app, String(current.logto_subject), String(current.organisation_id));
            return;
        }
        case 'entitlement_update': {
            const locked = await conn.query('SELECT organisation_id, application_id, revision, features, expires_at FROM titan.entitlements WHERE id=$1 FOR UPDATE', [c.id]);
            const current = locked.rows[0];
            if (!current || Number(current.revision) !== c.expectedRevision)
                throw Error('revision conflict: entitlement missing or changed');
            if (String(current.organisation_id) !== c.organisationId)
                throw Error('organisation mismatch: entitlement belongs to another organisation');
            const currentFeatures = Array.isArray(current.features) ? current.features.map(String) : [];
            const currentExpiry = isoOrNull(current.expires_at);
            const nextFeatures = c.features !== undefined ? [...c.features] : currentFeatures;
            const nextExpiry = c.expiresAt !== undefined ? (c.expiresAt ?? null) : currentExpiry;
            const updated = await conn.query('UPDATE titan.entitlements SET state=$3, features=$4, expires_at=$5, revision=revision+1 WHERE id=$1 AND revision=$2', [c.id, c.expectedRevision, c.state, nextFeatures, nextExpiry]);
            if (updated.rowCount !== 1)
                throw Error('revision conflict: entitlement changed');
            // A reduction is a state move out of access, a removed feature, or an expiry that moved earlier
            // (or became finite). Each one revokes sessions for this application in this transaction.
            const removedFeature = currentFeatures.some(f => !nextFeatures.includes(f));
            const expiryReduced = nextExpiry !== null && (currentExpiry === null || Date.parse(nextExpiry) < Date.parse(currentExpiry));
            if (c.state !== 'active' && c.state !== 'trialing' || removedFeature || expiryReduced) {
                const app = String(current.application_id);
                const members = await conn.query('SELECT i.logto_subject, m.organisation_id FROM titan.memberships m JOIN titan.identities i ON i.id=m.identity_id WHERE m.organisation_id=$1', [String(current.organisation_id)]);
                for (const row of members.rows)
                    await bumpGeneration(conn, app, String(row.logto_subject), String(row.organisation_id));
            }
            return;
        }
        case 'link_revoke': {
            const locked = await conn.query('SELECT l.organisation_id, l.application_id, l.state, l.revision, i.logto_subject FROM titan.local_account_links l JOIN titan.identities i ON i.id=l.identity_id WHERE l.id=$1 FOR UPDATE OF l', [c.id]);
            const current = locked.rows[0];
            if (!current || Number(current.revision) !== c.expectedRevision)
                throw Error('revision conflict: account link missing or changed');
            if (String(current.organisation_id) !== c.organisationId)
                throw Error('organisation mismatch: account link belongs to another organisation');
            if (current.state !== 'verified')
                throw Error('account link is not verified');
            const updated = await conn.query("UPDATE titan.local_account_links SET state='revoked', revision=revision+1 WHERE id=$1 AND revision=$2 AND state='verified'", [c.id, c.expectedRevision]);
            if (updated.rowCount !== 1)
                throw Error('revision conflict: account link changed');
            await bumpGeneration(conn, String(current.application_id), String(current.logto_subject), String(current.organisation_id));
            return;
        }
    }
}
/** Advances the session revocation generation for one application, subject and organisation.
 * Runs on the caller's transaction so a failure rolls back the row change and the audit record. */
async function bumpGeneration(conn, applicationId, logtoSubject, organisationId) {
    const result = await conn.query(`INSERT INTO titan.titan_session_revocations (application_id,logto_subject,organisation_id,generation)
VALUES ($1,$2,$3,1) ON CONFLICT (application_id,logto_subject,organisation_id)
DO UPDATE SET generation=titan_session_revocations.generation+1,revoked_at=now()
RETURNING generation`, [applicationId, logtoSubject, organisationId]);
    const value = Number(result.rows[0]?.generation);
    if (!Number.isSafeInteger(value) || value < 1)
        throw Error('revocation not confirmed');
}
