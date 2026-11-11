/** Support console read model (issue #39). Central's own data only.
 *
 * Every statement here is a SELECT. Reads run as titan_trusted_reader (migrations 0006, 0008, 0011). Organisation
 * scoped reads set titan.organisation_id for the transaction, so the row-level policies apply, and every row is
 * also checked against the requested organisation in application code (fail closed on any mismatch).
 *
 * Product health and provisioning progress are NOT read here. They belong to other products and are attached by
 * the API layer, where they are marked live or unavailable. This module has no node imports (the package has no
 * Node type declarations), so it has no timers or crypto. */
import type { SqlClient, SqlPool } from './postgres.js';
import type { ApplicationId, EntitlementStatus, MembershipStatus } from './contracts.js';
import { PRODUCT_IDS, toLegacyApplicationId } from './product-registry.js';
import type { ProductId } from './product-registry.js';
import { queryActivity } from './activity-events.js';
import type { ActivityEventRecord } from './activity-events.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOGTO_ID = /^[A-Za-z0-9_-]{1,256}$/;
export const SUPPORT_ACTIVITY_LIMIT_MAX = 50;
const MEMBERSHIP_STATES: readonly MembershipStatus[] = ['active', 'invited', 'suspended', 'revoked'];
const ENTITLEMENT_STATES: readonly EntitlementStatus[] = ['active', 'trialing', 'paused', 'expired', 'revoked'];
const LINK_STATES = ['verified', 'revoked'] as const;

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
 links: { verified: number; revoked: number };
}

export type SupportActivityEvent = Omit<ActivityEventRecord, 'organisationId' | 'recordedBy'>;

export interface SupportCentralSnapshot {
 readAt: string;
 organisation: SupportOrganisationRow;
 memberships: Record<MembershipStatus, number>;
 products: SupportProductCentral[];
 activity: { limit: number; events: SupportActivityEvent[] };
}

const ORGANISATION_SQL = 'SELECT id, logto_organisation_id, state, created_at FROM titan.organisations WHERE id = $1 LIMIT 2';
const ORGANISATION_BY_LOGTO_SQL = 'SELECT id, logto_organisation_id, state, created_at FROM titan.organisations WHERE logto_organisation_id = $1 LIMIT 2';
const MEMBERSHIP_COUNTS_SQL = 'SELECT state, count(*)::int AS n FROM titan.memberships WHERE organisation_id = $1 GROUP BY state';
const ENTITLEMENTS_SQL = 'SELECT organisation_id, application_id, state, expires_at, cardinality(features)::int AS feature_count FROM titan.entitlements WHERE organisation_id = $1';
const LINK_COUNTS_SQL = 'SELECT application_id, state, count(*)::int AS n FROM titan.local_account_links WHERE organisation_id = $1 GROUP BY application_id, state';

function isoOrNull(value: unknown): string | null {
 if (value === null || value === undefined) return null;
 const d = value instanceof Date ? value : new Date(String(value));
 if (!Number.isFinite(d.valueOf())) throw new Error('invalid timestamp from database');
 return d.toISOString();
}

function organisationRow(row: Record<string, unknown>): SupportOrganisationRow {
 return {
  id: String(row['id']),
  logtoOrganisationId: String(row['logto_organisation_id']),
  status: String(row['state']),
  createdAt: isoOrNull(row['created_at']) ?? '',
 };
}

/** Runs task in one read-only transaction as titan_trusted_reader. The organisation scope is bound as a parameter
 * and lasts for the transaction only, so a pooled connection never keeps it. Same shape as withCentralReadSnapshot. */
async function withReader<T>(pool: SqlPool, organisationId: string | undefined, task: (conn: SqlClient) => Promise<T>): Promise<T> {
 const conn = await pool.connect();
 let begun = false;
 try {
  await conn.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  begun = true;
  await conn.query('SET LOCAL ROLE titan_trusted_reader');
  if (organisationId !== undefined) await conn.query("SELECT set_config('titan.organisation_id', $1, true)", [organisationId]);
  await conn.query("SET LOCAL statement_timeout = '5000ms'");
  const result = await task(conn);
  await conn.query('COMMIT');
  begun = false;
  return result;
 } catch (error) {
  if (begun) { try { await conn.query('ROLLBACK'); } catch { /* original error remains authoritative */ } }
  throw error;
 } finally { conn.release?.(); }
}

/** Exact lookup by Central organisation id. Returns undefined when no organisation has that id. */
export async function findOrganisationById(pool: SqlPool, organisationId: string): Promise<SupportOrganisationRow | undefined> {
 if (typeof organisationId !== 'string' || !UUID.test(organisationId)) throw new Error('organisation id must be a UUID');
 return withReader(pool, undefined, async (conn) => {
  const r = await conn.query(ORGANISATION_SQL, [organisationId]);
  if (r.rows.length > 1) throw new Error('ambiguous organisation');
  const row = r.rows[0];
  if (!row) return undefined;
  const org = organisationRow(row);
  if (org.id !== organisationId) throw new Error('organisation scope violation');
  return org;
 });
}

/** Exact lookup by Logto organisation id, the value an operator sees in Logto. Returns at most one organisation. */
export async function findOrganisationByLogtoId(pool: SqlPool, logtoOrganisationId: string): Promise<SupportOrganisationRow | undefined> {
 if (typeof logtoOrganisationId !== 'string' || !LOGTO_ID.test(logtoOrganisationId)) throw new Error('invalid Logto organisation id');
 return withReader(pool, undefined, async (conn) => {
  const r = await conn.query(ORGANISATION_BY_LOGTO_SQL, [logtoOrganisationId]);
  if (r.rows.length > 1) throw new Error('ambiguous organisation');
  const row = r.rows[0];
  return row ? organisationRow(row) : undefined;
 });
}

export interface SupportReadOptions {
 now: Date;
 activityLimit: number;
}

/** Reads one organisation's Central state and recent activity. Returns undefined when the organisation does not
 * exist. Any row that belongs to another organisation makes the read throw, so no partial foreign data is returned. */
export async function readSupportCentralSnapshot(pool: SqlPool, organisationId: string, options: SupportReadOptions): Promise<SupportCentralSnapshot | undefined> {
 if (typeof organisationId !== 'string' || !UUID.test(organisationId)) throw new Error('organisation scope required');
 const limit = options.activityLimit;
 if (!Number.isSafeInteger(limit) || limit < 1 || limit > SUPPORT_ACTIVITY_LIMIT_MAX) throw new Error('invalid activity page size');
 if (!(options.now instanceof Date) || !Number.isFinite(options.now.valueOf())) throw new Error('invalid read time');
 const now = options.now;

 const central = await withReader(pool, organisationId, async (conn) => {
  const orgResult = await conn.query(ORGANISATION_SQL, [organisationId]);
  if (orgResult.rows.length > 1) throw new Error('ambiguous organisation');
  const orgRow = orgResult.rows[0];
  if (!orgRow) return undefined;
  const organisation = organisationRow(orgRow);
  if (organisation.id !== organisationId) throw new Error('organisation scope violation');

  const memberships = Object.fromEntries(MEMBERSHIP_STATES.map((s) => [s, 0])) as Record<MembershipStatus, number>;
  for (const row of (await conn.query(MEMBERSHIP_COUNTS_SQL, [organisationId])).rows) {
   const state = String(row['state']) as MembershipStatus;
   if (!MEMBERSHIP_STATES.includes(state)) throw new Error('unexpected membership state');
   memberships[state] = Number(row['n']);
  }

  const entitlementRows = (await conn.query(ENTITLEMENTS_SQL, [organisationId])).rows;
  for (const row of entitlementRows) {
   if (String(row['organisation_id']) !== organisationId) throw new Error('organisation scope violation');
   if (!ENTITLEMENT_STATES.includes(String(row['state']) as EntitlementStatus)) throw new Error('unexpected entitlement state');
  }

  const linkCounts = new Map<string, { verified: number; revoked: number }>();
  for (const row of (await conn.query(LINK_COUNTS_SQL, [organisationId])).rows) {
   const state = String(row['state']) as (typeof LINK_STATES)[number];
   if (!LINK_STATES.includes(state)) throw new Error('unexpected link state');
   const app = String(row['application_id']);
   const entry = linkCounts.get(app) ?? { verified: 0, revoked: 0 };
   entry[state] = Number(row['n']);
   linkCounts.set(app, entry);
  }

  const products: SupportProductCentral[] = PRODUCT_IDS.map((productId) => {
   const applicationId = toLegacyApplicationId(productId);
   const row = entitlementRows.find((r) => String(r['application_id']) === applicationId);
   const expiresAt = isoOrNull(row?.['expires_at']);
   const entitlement: SupportEntitlementView | null = row ? {
    status: String(row['state']) as EntitlementStatus,
    expiresAt,
    expired: expiresAt !== null && Date.parse(expiresAt) <= now.getTime(),
    featureCount: Number(row['feature_count'] ?? 0),
   } : null;
   return { productId, applicationId, entitlement, links: linkCounts.get(applicationId) ?? { verified: 0, revoked: 0 } };
  });

  return { readAt: now.toISOString(), organisation, memberships, products };
 });
 if (!central) return undefined;

 // The activity reader runs its own scoped transaction and rechecks every row's organisation (migration 0011).
 const events = await queryActivity(pool, organisationId, { limit });
 return {
  ...central,
  activity: {
   limit,
   events: events.map(({ organisationId: _o, recordedBy: _r, ...event }) => event),
  },
 };
}
