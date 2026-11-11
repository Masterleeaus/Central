/** Organisation administration: the operator read model and the tenant-administrator authority policy.
 * Reads run through withTenantReadScope (titan_trusted_reader, one organisation per snapshot, RLS from 0006/0008).
 * Tenant mutations are NOT executed here. This module only decides whether a tenant administrator may
 * perform a membership command; the command itself runs through TrustedProvisioningService and CentralProvisioner,
 * which apply the expected revision, the session revocation generation and the audit row in one transaction.
 */
import type { MembershipRole } from './contracts.js';
import type { SqlPool, SqlClient, MemberState } from './postgres.js';
import { withTenantReadScope } from './postgres.js';
import type { ProvisioningCommand } from './provisioning.js';
import type { AuthorizeProvisioning, TrustedActor, GetCanonicalLogtoId } from './trusted-provisioning.js';
import { LogtoAuthorityError, type LogtoManagementVerifier } from './logto-management.js';

/** Higher is more privileged. A tenant administrator may only assign or change roles strictly below their own. */
export const ROLE_RANK: Readonly<Record<MembershipRole, number>> = Object.freeze({ learner: 0, member: 1, manager: 2, admin: 3, owner: 4 });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const validId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 256 && /^[A-Za-z0-9_-]+$/.test(value);

export interface OrganisationAccess {
  organisation: { id: string; logtoOrganisationId: string; state: string };
  memberships: Array<{ id: string; identityId: string; logtoSubject: string; role: string; state: string; expiresAt?: string; revision: number }>;
  entitlements: Array<{ id: string; applicationId: string; state: string; features: string[]; expiresAt?: string; revision: number }>;
  links: Array<{ id: string; identityId: string; applicationId: string; localUserId: string; localAccountId: string; state: string; verifiedAt?: string; revision: number }>;
}

const ORGANISATION_SQL = 'SELECT id, logto_organisation_id, state FROM titan.organisations WHERE id=$1';
const MEMBERSHIPS_SQL = 'SELECT m.id, m.identity_id, i.logto_subject, m.role, m.state, m.expires_at, m.revision FROM titan.memberships m JOIN titan.identities i ON i.id=m.identity_id WHERE m.organisation_id=$1 ORDER BY i.logto_subject, m.id';
const ENTITLEMENTS_SQL = 'SELECT id, application_id, state, features, expires_at, revision FROM titan.entitlements WHERE organisation_id=$1 ORDER BY application_id, id';
const LINKS_SQL = 'SELECT id, identity_id, application_id, local_user_id, local_account_id, state, verified_at, revision FROM titan.local_account_links WHERE organisation_id=$1 ORDER BY application_id, id';
const ACTOR_MEMBERSHIP_SQL = "SELECT m.id, m.identity_id, m.role FROM titan.memberships m JOIN titan.identities i ON i.id=m.identity_id WHERE i.logto_subject=$1 AND i.state='active' AND m.organisation_id=$2 AND m.state='active' AND (m.expires_at IS NULL OR m.expires_at>now())";
const TARGET_MEMBERSHIP_SQL = 'SELECT m.id, m.identity_id, i.logto_subject, m.role, m.state, m.revision FROM titan.memberships m JOIN titan.identities i ON i.id=m.identity_id WHERE m.id=$1 AND m.organisation_id=$2';

const text = (row: Record<string, unknown>, key: string): string => String(row[key] ?? '');
const iso = (value: unknown): string | undefined => (value === null || value === undefined ? undefined : new Date(value as string).toISOString());
const revisionOf = (value: unknown): number => { const n = Number(value); if (!Number.isSafeInteger(n) || n < 1) throw new Error('invalid revision'); return n; };

/** Operator read: one organisation per call. Returns undefined when the organisation does not exist. */
export async function readOrganisationAccess(pool: SqlPool, organisationId: string): Promise<OrganisationAccess | undefined> {
  return withTenantReadScope(pool, organisationId, async (conn: SqlClient) => {
    const org = await conn.query(ORGANISATION_SQL, [organisationId]);
    if (org.rows.length !== 1) return undefined;
    const members = await conn.query(MEMBERSHIPS_SQL, [organisationId]);
    const grants = await conn.query(ENTITLEMENTS_SQL, [organisationId]);
    const links = await conn.query(LINKS_SQL, [organisationId]);
    const row = org.rows[0];
    return {
      organisation: { id: text(row, 'id'), logtoOrganisationId: text(row, 'logto_organisation_id'), state: text(row, 'state') },
      memberships: members.rows.map(r => ({ id: text(r, 'id'), identityId: text(r, 'identity_id'), logtoSubject: text(r, 'logto_subject'), role: text(r, 'role'), state: text(r, 'state'), expiresAt: iso(r['expires_at']), revision: revisionOf(r['revision']) })),
      entitlements: grants.rows.map(r => ({ id: text(r, 'id'), applicationId: text(r, 'application_id'), state: text(r, 'state'), features: Array.isArray(r['features']) ? r['features'].map(String) : [], expiresAt: iso(r['expires_at']), revision: revisionOf(r['revision']) })),
      links: links.rows.map(r => ({ id: text(r, 'id'), identityId: text(r, 'identity_id'), applicationId: text(r, 'application_id'), localUserId: text(r, 'local_user_id'), localAccountId: text(r, 'local_account_id'), state: text(r, 'state'), verifiedAt: iso(r['verified_at']), revision: revisionOf(r['revision']) })),
    };
  });
}

export interface ActorMembership { id: string; identityId: string; role: MembershipRole; }
export interface TargetMembership { id: string; identityId: string; logtoSubject: string; role: MembershipRole; state: MemberState; revision: number; }
/** Reads used by the tenant policy. Every read is scoped to one organisation, so another tenant's rows are invisible. */
export interface TenantAdministrationStore {
  actorMembership(logtoSubject: string, organisationId: string): Promise<ActorMembership | undefined>;
  membership(membershipId: string, organisationId: string): Promise<TargetMembership | undefined>;
}
export function createPostgresTenantAdministrationStore(pool: SqlPool): TenantAdministrationStore {
  return {
    async actorMembership(logtoSubject, organisationId) {
      return withTenantReadScope(pool, organisationId, async conn => {
        const r = await conn.query(ACTOR_MEMBERSHIP_SQL, [logtoSubject, organisationId]);
        if (r.rows.length !== 1) return undefined; // none, or ambiguous: fail closed
        return { id: text(r.rows[0], 'id'), identityId: text(r.rows[0], 'identity_id'), role: text(r.rows[0], 'role') as MembershipRole };
      });
    },
    async membership(membershipId, organisationId) {
      return withTenantReadScope(pool, organisationId, async conn => {
        const r = await conn.query(TARGET_MEMBERSHIP_SQL, [membershipId, organisationId]);
        if (r.rows.length !== 1) return undefined;
        const row = r.rows[0];
        return { id: text(row, 'id'), identityId: text(row, 'identity_id'), logtoSubject: text(row, 'logto_subject'), role: text(row, 'role') as MembershipRole, state: text(row, 'state') as MemberState, revision: revisionOf(row['revision']) };
      });
    },
  };
}

/** Delegation rule: a tenant administrator may assign only roles strictly below their own, never owner. */
export function canDelegateRole(actorRole: MembershipRole, targetRole: MembershipRole): boolean {
  return targetRole !== 'owner' && ROLE_RANK[targetRole] < ROLE_RANK[actorRole];
}

export interface TenantAdministrationOptions {
  verifier: LogtoManagementVerifier;
  resolve: GetCanonicalLogtoId;
  store: TenantAdministrationStore;
  /** Logto organisation role IDs that mark a tenant administrator. Provisioned by a trusted operator. */
  administrativeRoleIds: readonly string[];
}

/** Authority for tenant administrators. Allows only membership and membership_update, only for the command's
 * organisation, only for owners and administrators of that organisation, and only within the delegation rule.
 * Fails closed: any refusal, unknown target, other tenant's row or self-change returns false.
 * Checks, in order: trusted actor; command kind; Titan membership and role; target row in the same organisation;
 * delegation; then live Logto membership and administrator role. Logto infrastructure failures reject. */
export function createTenantAdministrationAuthorizer(opts: TenantAdministrationOptions): AuthorizeProvisioning {
  const roles = opts.administrativeRoleIds;
  if (!Array.isArray(roles) || roles.length === 0 || roles.length > 32 || roles.some(id => !validId(id)) || new Set(roles).size !== roles.length)
    throw new Error('explicit Logto administrator role IDs are required');
  return async (actor: TrustedActor, command: ProvisioningCommand): Promise<boolean> => {
    if (!validId(actor?.logtoSubject) || actor.operatorAuthorityVerified !== true) return false;
    if (command.kind !== 'membership' && command.kind !== 'membership_update') return false;
    if (typeof command.organisationId !== 'string' || !UUID.test(command.organisationId)) return false;
    const organisationId = command.organisationId;
    const me = await opts.store.actorMembership(actor.logtoSubject, organisationId);
    if (!me || (me.role !== 'owner' && me.role !== 'admin')) return false;
    if (command.kind === 'membership') {
      if (command.identityId === me.identityId) return false;
      if (!canDelegateRole(me.role, command.role)) return false;
    } else {
      const target = await opts.store.membership(command.id, organisationId);
      if (!target) return false;
      if (target.identityId === me.identityId) return false;
      if (!(ROLE_RANK[target.role] < ROLE_RANK[me.role])) return false;
      if (command.role !== undefined && !canDelegateRole(me.role, command.role)) return false;
    }
    const logtoOrganisationId = await opts.resolve('organisation', organisationId);
    if (!validId(logtoOrganisationId)) return false;
    try {
      await opts.verifier.assertMembership(actor.logtoSubject, logtoOrganisationId);
      await opts.verifier.assertAnyOrganisationRole(actor.logtoSubject, logtoOrganisationId, roles);
      return true;
    } catch (e) {
      if (e instanceof LogtoAuthorityError) return false;
      throw e;
    }
  };
}
