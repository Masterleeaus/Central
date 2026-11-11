import { OnboardingStaleRevision, OnboardingUniqueViolation, } from './onboarding.js';
const UUID_TEXT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const iso = (v) => (v instanceof Date ? v : new Date(String(v))).toISOString();
const opt = (v) => (v === null || v === undefined ? undefined : String(v));
function onboarding(r) {
    return {
        id: String(r.id),
        idempotencyKey: String(r.idempotency_key),
        organisationId: String(r.organisation_id),
        logtoOrganisationId: String(r.logto_organisation_id),
        ownerLogtoSubject: String(r.owner_logto_subject),
        organisationName: String(r.organisation_name),
        products: r.products.map(String),
        requestDigest: String(r.request_digest),
        state: String(r.state),
        ownerProofDigest: opt(r.owner_proof_digest),
        failureCode: opt(r.failure_code),
        rolledBackAt: r.rolled_back_at === null || r.rolled_back_at === undefined ? undefined : iso(r.rolled_back_at),
        revision: Number(r.revision),
    };
}
function product(r) {
    return {
        onboardingId: String(r.onboarding_id),
        organisationId: String(r.organisation_id),
        application: String(r.application_id),
        accountLinkRequired: r.account_link_required === true,
        outcome: String(r.outcome),
        failureCode: opt(r.failure_code),
        entitlementId: opt(r.entitlement_id),
        entitlementRequestId: opt(r.entitlement_request_id),
        linkId: opt(r.link_id),
        linkRequestId: opt(r.link_request_id),
        attempts: Number(r.attempts),
        rolledBackAt: r.rolled_back_at === null || r.rolled_back_at === undefined ? undefined : iso(r.rolled_back_at),
    };
}
const COLUMNS = 'id, idempotency_key, organisation_id, logto_organisation_id, owner_logto_subject, organisation_name, products, request_digest, state, owner_proof_digest, failure_code, rolled_back_at, revision';
const PRODUCT_COLUMNS = 'onboarding_id, organisation_id, application_id, account_link_required, outcome, failure_code, entitlement_id, entitlement_request_id, link_id, link_request_id, attempts, rolled_back_at';
export class PostgresOnboardingStore {
    pool;
    constructor(pool) {
        this.pool = pool;
    }
    /** `scope` sets titan.organisation_id for the transaction. Migration 0008 scopes the trusted reader's memberships,
     * entitlements and links to it, and fails closed when it is unset. */
    async inRole(role, ctx, task, scope) {
        if (scope !== undefined && !UUID_TEXT.test(scope))
            throw new Error('organisation scope must be a UUID');
        const conn = await this.pool.connect();
        let begun = false;
        try {
            await conn.query('BEGIN');
            begun = true;
            // `role` is one of two constants from the Role union, never input.
            await conn.query(`SET LOCAL ROLE ${role}`);
            await conn.query("SET LOCAL statement_timeout = '5000ms'");
            if (scope !== undefined)
                await conn.query("SELECT set_config('titan.organisation_id', $1, true)", [scope]);
            if (ctx) {
                await conn.query("SELECT set_config('titan.actor_subject', $1, true)", [ctx.actorSubject]);
                await conn.query("SELECT set_config('titan.request_id', $1, true)", [ctx.requestId]);
            }
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
                catch { /* the original error is the one to report */ }
            }
            throw error;
        }
        finally {
            conn.release?.();
        }
    }
    async findByKey(idempotencyKey) {
        return this.inRole('titan_trusted_reader', undefined, async (c) => {
            const r = await c.query(`SELECT ${COLUMNS} FROM titan.onboardings WHERE idempotency_key=$1`, [idempotencyKey]);
            return r.rows[0] && onboarding(r.rows[0]);
        });
    }
    async findById(id) {
        return this.inRole('titan_trusted_reader', undefined, async (c) => {
            const r = await c.query(`SELECT ${COLUMNS} FROM titan.onboardings WHERE id=$1`, [id]);
            return r.rows[0] && onboarding(r.rows[0]);
        });
    }
    async insert(row, ctx) {
        try {
            await this.inRole('titan_trusted_writer', ctx, (c) => c.query("INSERT INTO titan.onboardings (id, idempotency_key, organisation_id, logto_organisation_id, owner_logto_subject, organisation_name, products, request_digest, state) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending')", [row.id, row.idempotencyKey, row.organisationId, row.logtoOrganisationId, row.ownerLogtoSubject, row.organisationName, [...row.products], row.requestDigest]));
        }
        catch (error) {
            if (error?.code === '23505')
                throw new OnboardingUniqueViolation();
            throw error;
        }
    }
    async transition(input, ctx) {
        return this.inRole('titan_trusted_writer', ctx, async (c) => {
            // COALESCE keeps the recorded failure code on a rollback mark; the trigger clears it for any non-failed state.
            const r = await c.query(`UPDATE titan.onboardings SET state=$3,
           owner_proof_digest=COALESCE($4::text, owner_proof_digest),
           owner_proof_at=CASE WHEN $4::text IS NULL THEN owner_proof_at ELSE now() END,
           failure_code=COALESCE($5::text, failure_code),
           rolled_back_at=CASE WHEN $6::boolean THEN now() ELSE rolled_back_at END
         WHERE id=$1 AND revision=$2
         RETURNING ${COLUMNS}`, [input.id, input.expectedRevision, input.to, input.ownerProofDigest ?? null, input.failureCode ?? null, input.rolledBack === true]);
            if (r.rows.length !== 1)
                throw new OnboardingStaleRevision();
            return onboarding(r.rows[0]);
        });
    }
    async products(onboardingId) {
        return this.inRole('titan_trusted_reader', undefined, async (c) => {
            const r = await c.query(`SELECT ${PRODUCT_COLUMNS} FROM titan.onboarding_product_results WHERE onboarding_id=$1 ORDER BY application_id`, [onboardingId]);
            return r.rows.map(product);
        });
    }
    async saveProduct(p, ctx) {
        await this.inRole('titan_trusted_writer', ctx, (c) => c.query(`INSERT INTO titan.onboarding_product_results (${PRODUCT_COLUMNS})
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, CASE WHEN $12::boolean THEN now() END)
       ON CONFLICT (onboarding_id, application_id) DO UPDATE SET
         outcome=EXCLUDED.outcome, failure_code=EXCLUDED.failure_code,
         entitlement_id=EXCLUDED.entitlement_id, entitlement_request_id=EXCLUDED.entitlement_request_id,
         link_id=EXCLUDED.link_id, link_request_id=EXCLUDED.link_request_id,
         attempts=EXCLUDED.attempts, rolled_back_at=COALESCE(EXCLUDED.rolled_back_at, titan.onboarding_product_results.rolled_back_at)`, [p.onboardingId, p.organisationId, p.application, p.accountLinkRequired, p.outcome, p.failureCode ?? null,
            p.entitlementId ?? null, p.entitlementRequestId ?? null, p.linkId ?? null, p.linkRequestId ?? null, p.attempts, p.rolledBackAt !== undefined]));
    }
    async identityForSubject(logtoSubject) {
        return this.inRole('titan_trusted_reader', undefined, async (c) => {
            const r = await c.query('SELECT id, state FROM titan.identities WHERE logto_subject=$1 LIMIT 2', [logtoSubject]);
            if (r.rows.length > 1)
                throw new Error('ambiguous identity');
            return r.rows[0] && { id: String(r.rows[0].id), state: String(r.rows[0].state) };
        });
    }
    async organisationExists(id) {
        return this.inRole('titan_trusted_reader', undefined, async (c) => {
            const r = await c.query('SELECT 1 FROM titan.organisations WHERE id=$1', [id]);
            return r.rows.length > 0;
        });
    }
    async membershipFor(identityId, organisationId) {
        return this.inRole('titan_trusted_reader', undefined, async (c) => {
            const r = await c.query('SELECT role, state FROM titan.memberships WHERE identity_id=$1 AND organisation_id=$2', [identityId, organisationId]);
            return r.rows[0] && { role: String(r.rows[0].role), state: String(r.rows[0].state) };
        }, organisationId);
    }
    async entitlement(organisationId, id) {
        return this.inRole('titan_trusted_reader', undefined, async (c) => {
            const r = await c.query('SELECT organisation_id, application_id, state, revision FROM titan.entitlements WHERE id=$1', [id]);
            return r.rows[0] && { organisationId: String(r.rows[0].organisation_id), applicationId: String(r.rows[0].application_id), state: String(r.rows[0].state), revision: Number(r.rows[0].revision) };
        }, organisationId);
    }
    async link(organisationId, id) {
        return this.inRole('titan_trusted_reader', undefined, async (c) => {
            const r = await c.query('SELECT organisation_id, application_id, state, revision FROM titan.local_account_links WHERE id=$1', [id]);
            return r.rows[0] && { organisationId: String(r.rows[0].organisation_id), applicationId: String(r.rows[0].application_id), state: String(r.rows[0].state), revision: Number(r.rows[0].revision) };
        }, organisationId);
    }
}
