/** Subscription lifecycle service (issue #35): verify, dedupe, order, check the transition, map, then mutate
 * entitlements only through the provisioning port with the expected revision.
 *
 * Ordering and replay rules (details in docs/SUBSCRIPTIONS.md):
 * - Every delivery is verified over its raw bytes before anything is stored or parsed further.
 * - Events are processed under a per-subscription lock, so two deliveries for one subscription never interleave.
 * - A provider event id seen before with a final disposition is a duplicate and changes nothing.
 * - An event whose (occurredAt, providerEventId) is older than the last applied position is recorded as
 *   ignored_out_of_order. The same event id as the last position is re-run (crash recovery), and the mutations
 *   are no-ops when the entitlements already match.
 * - A transition the state table does not allow is recorded as rejected. Refunded and expired are terminal,
 *   so a late "active" event cannot re-enable access.
 * - Every entitlement write carries the revision it was computed from. A concurrent writer makes it fail.
 */
import { createHash } from 'node:crypto';
import type { ApplicationId } from './contracts.js';
import type { GrantState } from './postgres.js';
import type { ProvisioningCommand, ProvisioningContext } from './provisioning.js';
import { CatalogueError, type PlanCatalogue } from './plan-catalogue.js';
import {
  isAccessGrantState, isAllowedTransition, mapSubscriptionToEntitlements, SubscriptionMappingError,
  type EntitlementChange, type SubscriptionState,
} from './subscription-model.js';
import type { BillingProviderAdapter, ProviderEvent, ProviderRequest } from './billing-adapter.js';
import type { WebhookRejectCode } from './webhook-verifier.js';

export type LedgerDisposition = 'pending' | 'applied' | 'ignored_out_of_order' | 'rejected_transition' | 'rejected_invalid' | 'rejected_organisation';
export interface SubscriptionRecord { organisationId: string; state: SubscriptionState; positionAt: string; positionEventId: string; }
export interface LedgerEventKey { provider: string; providerEventId: string; subscriptionId: string; occurredAt: string; }
export interface LedgerTx {
  /** Records the event as pending unless it already exists. */
  beginEvent(event: LedgerEventKey): Promise<{ kind: 'new' } | { kind: 'existing'; disposition: LedgerDisposition }>;
  subscription(provider: string, subscriptionId: string): Promise<SubscriptionRecord | undefined>;
  /** Sets the last applied position. Called only after the entitlement writes for the event succeeded. */
  advance(provider: string, subscriptionId: string, record: SubscriptionRecord): Promise<void>;
  finish(provider: string, providerEventId: string, disposition: Exclude<LedgerDisposition, 'pending'>, detail: { reason: string; requestIds: readonly string[] }): Promise<void>;
}
export interface BillingLedger {
  withSubscriptionLock<T>(provider: string, subscriptionId: string, task: (tx: LedgerTx) => Promise<T>): Promise<T>;
}
export interface EntitlementRow { id: string; revision: number; state: GrantState; features: readonly string[]; expiresAt: string | null; }
export interface EntitlementReader {
  entitlement(organisationId: string, applicationId: ApplicationId): Promise<EntitlementRow | undefined>;
}
/** The trusted provisioning mutation path. CentralProvisioner satisfies this; the caller may wrap it in an authority gate. */
export interface ProvisioningPort {
  apply(context: ProvisioningContext, command: ProvisioningCommand): Promise<unknown>;
}

export type LifecycleRejectCode = WebhookRejectCode | 'invalid_payload' | 'transition_not_allowed' | 'organisation_mismatch' | 'mapping_invalid';
export type LifecycleOutcome =
  | { status: 'applied'; mutations: number }
  | { status: 'duplicate' }
  | { status: 'ignored'; reason: 'out_of_order' }
  | { status: 'rejected'; code: LifecycleRejectCode; reason?: string };

export interface LifecycleOptions {
  adapter: BillingProviderAdapter;
  /** Webhook signing secret, from the caller's secret store. */
  secret: string;
  ledger: BillingLedger;
  entitlements: EntitlementReader;
  provisioning: ProvisioningPort;
  catalogue: PlanCatalogue;
  clock?: () => Date;
}

const sha256Hex = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');

/** Deterministic UUID (version 5 layout) from the given parts. Used for request ids and entitlement ids, so a
 * replayed event produces the same request id and is recognised by the provisioning audit table. */
export function deriveUuid(...parts: readonly string[]): string {
  const hex = sha256Hex(JSON.stringify(parts)).slice(0, 32).split('');
  hex[12] = '5';
  hex[16] = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  const s = hex.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
}

function comparePosition(a: { at: string; id: string }, b: { at: string; id: string }): number {
  const delta = Date.parse(a.at) - Date.parse(b.at);
  if (delta !== 0) return delta < 0 ? -1 : 1;
  return a.id === b.id ? 0 : a.id < b.id ? -1 : 1;
}

function sameGrant(current: EntitlementRow, change: EntitlementChange): boolean {
  if (current.state !== change.state || current.expiresAt !== change.expiresAt) return false;
  const a = [...current.features].sort();
  const b = [...change.features].sort();
  return a.length === b.length && a.every((f, i) => f === b[i]);
}

export class SubscriptionLifecycle {
  constructor(private readonly options: LifecycleOptions) {
    if (!options.catalogue || options.catalogue.validated !== true) throw new Error('a validated plan catalogue is required');
    if (typeof options.secret !== 'string' || options.secret.length === 0) throw new Error('webhook secret is required');
  }

  async handle(request: ProviderRequest): Promise<LifecycleOutcome> {
    const now = this.options.clock?.() ?? new Date();
    const verification = this.options.adapter.verify(request, this.options.secret, now);
    if (!verification.ok) return { status: 'rejected', code: verification.code };
    let event: ProviderEvent;
    try {
      event = this.options.adapter.parse(request.rawBody);
    } catch {
      return { status: 'rejected', code: 'invalid_payload' };
    }
    if (event.provider !== this.options.adapter.name) return { status: 'rejected', code: 'invalid_payload' };
    return this.options.ledger.withSubscriptionLock(event.provider, event.subscriptionId, tx => this.process(tx, event));
  }

  private async process(tx: LedgerTx, event: ProviderEvent): Promise<LifecycleOutcome> {
    const begun = await tx.beginEvent({ provider: event.provider, providerEventId: event.providerEventId, subscriptionId: event.subscriptionId, occurredAt: event.occurredAt });
    if (begun.kind === 'existing' && begun.disposition !== 'pending') return { status: 'duplicate' };

    const current = await tx.subscription(event.provider, event.subscriptionId);
    if (current && current.organisationId !== event.organisationId) {
      return this.finish(tx, event, 'rejected_organisation', { code: 'organisation_mismatch', reason: 'organisation_mismatch' });
    }
    if (current && comparePosition({ at: event.occurredAt, id: event.providerEventId }, { at: current.positionAt, id: current.positionEventId }) < 0) {
      return this.finish(tx, event, 'ignored_out_of_order', { reason: 'out_of_order' });
    }
    if (!isAllowedTransition(current?.state, event.snapshot.state)) {
      return this.finish(tx, event, 'rejected_transition', { code: 'transition_not_allowed', reason: `${current?.state ?? 'none'}->${event.snapshot.state}` });
    }

    let changes: readonly EntitlementChange[];
    try {
      changes = mapSubscriptionToEntitlements(event.snapshot, this.options.catalogue);
    } catch (error) {
      if (error instanceof SubscriptionMappingError || error instanceof CatalogueError) {
        return this.finish(tx, event, 'rejected_invalid', { code: 'mapping_invalid', reason: error.message });
      }
      throw error;
    }

    const requestIds: string[] = [];
    for (const change of changes) requestIds.push(...await this.applyChange(event, change));
    await tx.advance(event.provider, event.subscriptionId, {
      organisationId: event.organisationId, state: event.snapshot.state, positionAt: event.occurredAt, positionEventId: event.providerEventId,
    });
    await tx.finish(event.provider, event.providerEventId, 'applied', { reason: '', requestIds });
    return { status: 'applied', mutations: requestIds.length };
  }

  /** Writes one application's change through the provisioning port. Returns the request ids it used. */
  private async applyChange(event: ProviderEvent, change: EntitlementChange): Promise<string[]> {
    const current = await this.options.entitlements.entitlement(event.organisationId, change.applicationId);
    if (current) {
      if (sameGrant(current, change)) return [];
      const requestId = deriveUuid('entitlement-update', event.provider, event.providerEventId, change.applicationId);
      await this.options.provisioning.apply(this.context(event, requestId), {
        kind: 'entitlement_update', id: current.id, organisationId: event.organisationId, expectedRevision: current.revision,
        state: change.state, features: change.features, expiresAt: change.expiresAt,
      });
      return [requestId];
    }
    // No row and nothing to grant: a removal of something that was never provisioned is a no-op.
    if (!isAccessGrantState(change.state) || change.features.length === 0) return [];
    const entitlementId = deriveUuid('entitlement', event.organisationId, change.applicationId);
    const createRequest = deriveUuid('entitlement-create', event.provider, event.providerEventId, change.applicationId);
    await this.options.provisioning.apply(this.context(event, createRequest), {
      kind: 'entitlement', id: entitlementId, organisationId: event.organisationId, applicationId: change.applicationId,
      features: change.features, expiresAt: change.expiresAt ?? undefined,
    });
    const ids = [createRequest];
    if (change.state !== 'active') {
      // Create always starts active; a trial needs one follow-up update from the revision it was created at.
      const updateRequest = deriveUuid('entitlement-update', event.provider, event.providerEventId, change.applicationId);
      await this.options.provisioning.apply(this.context(event, updateRequest), {
        kind: 'entitlement_update', id: entitlementId, organisationId: event.organisationId, expectedRevision: 1,
        state: change.state, features: change.features, expiresAt: change.expiresAt,
      });
      ids.push(updateRequest);
    }
    return ids;
  }

  private context(event: ProviderEvent, requestId: string): ProvisioningContext {
    return {
      actorSubject: `billing:${event.provider}`,
      authorityReference: `billing-event:${event.provider}:${sha256Hex(event.providerEventId).slice(0, 32)}`,
      requestId,
    };
  }

  private async finish(
    tx: LedgerTx,
    event: ProviderEvent,
    disposition: Exclude<LedgerDisposition, 'pending' | 'applied'>,
    outcome: { code?: LifecycleRejectCode; reason: string },
  ): Promise<LifecycleOutcome> {
    await tx.finish(event.provider, event.providerEventId, disposition, { reason: outcome.reason, requestIds: [] });
    if (disposition === 'ignored_out_of_order') return { status: 'ignored', reason: 'out_of_order' };
    return { status: 'rejected', code: outcome.code ?? 'invalid_payload', reason: outcome.reason };
  }
}
