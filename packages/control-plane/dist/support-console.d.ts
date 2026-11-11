/** Support console read model (issue #39). Central's own data only.
 *
 * Every statement here is a SELECT. Reads run as titan_trusted_reader (migrations 0006, 0008, 0011). Organisation
 * scoped reads set titan.organisation_id for the transaction, so the row-level policies apply, and every row is
 * also checked against the requested organisation in application code (fail closed on any mismatch).
 *
 * Product health and provisioning progress are NOT read here. They belong to other products and are attached by
 * the API layer, where they are marked live or unavailable. This module has no node imports (the package has no
 * Node type declarations), so it has no timers or crypto. */
import type { SqlPool } from './postgres.js';
import type { ApplicationId, EntitlementStatus, MembershipStatus } from './contracts.js';
import type { ProductId } from './product-registry.js';
import type { ActivityEventRecord } from './activity-events.js';
export declare const SUPPORT_ACTIVITY_LIMIT_MAX = 50;
export interface SupportOrganisationRow {
    id: string;
    logtoOrganisationId: string;
    status: string;
    createdAt: string;
}
export interface SupportEntitlementView {
    status: EntitlementStatus;
    expiresAt: string | null;
    /** True when expiresAt is at or before the read time, whatever the stored status says. */
    expired: boolean;
    featureCount: number;
}
export interface SupportProductCentral {
    productId: ProductId;
    applicationId: ApplicationId;
    entitlement: SupportEntitlementView | null;
    /** Counts of local account links by state. Local account identifiers are never returned. */
    links: {
        verified: number;
        revoked: number;
    };
}
export type SupportActivityEvent = Omit<ActivityEventRecord, 'organisationId' | 'recordedBy'>;
export interface SupportCentralSnapshot {
    readAt: string;
    organisation: SupportOrganisationRow;
    memberships: Record<MembershipStatus, number>;
    products: SupportProductCentral[];
    activity: {
        limit: number;
        events: SupportActivityEvent[];
    };
}
/** Exact lookup by Central organisation id. Returns undefined when no organisation has that id. */
export declare function findOrganisationById(pool: SqlPool, organisationId: string): Promise<SupportOrganisationRow | undefined>;
/** Exact lookup by Logto organisation id, the value an operator sees in Logto. Returns at most one organisation. */
export declare function findOrganisationByLogtoId(pool: SqlPool, logtoOrganisationId: string): Promise<SupportOrganisationRow | undefined>;
export interface SupportReadOptions {
    now: Date;
    activityLimit: number;
}
/** Reads one organisation's Central state and recent activity. Returns undefined when the organisation does not
 * exist. Any row that belongs to another organisation makes the read throw, so no partial foreign data is returned. */
export declare function readSupportCentralSnapshot(pool: SqlPool, organisationId: string, options: SupportReadOptions): Promise<SupportCentralSnapshot | undefined>;
