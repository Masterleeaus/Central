const uuid = (v) => typeof v === 'string' && /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(v);
const nonempty = (s, max = 256) => typeof s === 'string' && s.length > 0 && s.length <= max && s.trim() === s && !/[\x00-\x1f\x7f]/.test(s);
const roles = new Set(['owner', 'admin', 'manager', 'member', 'learner']);
const apps = new Set(['sorted', 'supercharged', 'lms']);
const validDate = (d) => !d || (Number.isFinite(Date.parse(d)) && new Date(d).toISOString() === d);
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
        default: throw Error('unsupported provisioning command');
    }
}
/** Exactly one transaction and one audit event per idempotency key.
 * Conflicts never mutate another identity's mapping. Replays return the original result.
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
            await insertProvisioning(conn, command);
            await conn.query('INSERT INTO titan.provisioning_audit(request_id,actor_subject,authority_reference,command_kind,command_digest,subject_id) VALUES ($1,$2,$3,$4,$5,$6)', [context.requestId, context.actorSubject, context.authorityReference, command.kind, digest, command.id]);
            await conn.query('COMMIT');
            begun = false;
            return 'created';
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
