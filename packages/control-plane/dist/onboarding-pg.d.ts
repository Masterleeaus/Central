/** PostgreSQL adapter for OnboardingStore (migration 0017). Reads run as titan_trusted_reader and writes run as
 * titan_trusted_writer, each in one transaction. Writes also set titan.actor_subject and titan.request_id, which the
 * audit trigger requires, with set_config(..., true) so they end with the transaction. The application must not
 * connect as a superuser or BYPASSRLS role. */
import type { SqlPool } from './postgres.js';
import { type OnboardingRow, type OnboardingStore, type ProductRow, type TransitionChange, type WriteContext } from './onboarding.js';
export declare class PostgresOnboardingStore implements OnboardingStore {
    private readonly pool;
    constructor(pool: SqlPool);
    /** `scope` sets titan.organisation_id for the transaction. Migration 0008 scopes the trusted reader's memberships,
     * entitlements and links to it, and fails closed when it is unset. */
    private inRole;
    findByKey(idempotencyKey: string): Promise<OnboardingRow | undefined>;
    findById(id: string): Promise<OnboardingRow | undefined>;
    insert(row: OnboardingRow, ctx: WriteContext): Promise<void>;
    transition(input: TransitionChange & {
        id: string;
        expectedRevision: number;
    }, ctx: WriteContext): Promise<OnboardingRow>;
    products(onboardingId: string): Promise<ProductRow[]>;
    saveProduct(p: ProductRow, ctx: WriteContext): Promise<void>;
    identityForSubject(logtoSubject: string): Promise<{
        id: string;
        state: string;
    } | undefined>;
    organisationExists(id: string): Promise<boolean>;
    membershipFor(identityId: string, organisationId: string): Promise<{
        role: string;
        state: string;
    } | undefined>;
    entitlement(organisationId: string, id: string): Promise<{
        organisationId: string;
        applicationId: string;
        state: string;
        revision: number;
    }>;
    link(organisationId: string, id: string): Promise<{
        organisationId: string;
        applicationId: string;
        state: string;
        revision: number;
    }>;
}
