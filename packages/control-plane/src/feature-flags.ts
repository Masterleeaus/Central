// Centrally governed configuration and feature flags (issue #38).
//
// Declarations (type, allowed values, default, owner) live in code and are the source of truth.
// Stored scope rows are copies of a declaration plus the value, rollout or cohort, and expiry. The
// database enforces the same type rules (migrations/0013_feature_flags.sql); this module checks them
// again so that a bad row never reaches a product.
//
// Precedence for one flag and one organisation, first match wins:
//   1. organisation override, if it has not expired
//   2. global row with a cohort, if the verified organisation is in that cohort
//   3. global row with a rollout percentage, if the organisation's deterministic bucket is below it
//   4. global row with neither, which serves its value to everyone
//   5. the declared default
// An expired row is ignored and resolution continues with the next layer.
//
// Any failure to read the store, or any row that does not match its declaration, resolves to the
// declared default. The resolver never returns a value that is not declared.

import { createHash } from 'node:crypto';

export const FLAG_PRODUCTS = ['sorted', 'supercharged', 'lms', 'central'] as const;
export type FlagProduct = (typeof FLAG_PRODUCTS)[number];

export const FLAG_ENVIRONMENTS = ['development', 'staging', 'production'] as const;
export type FlagEnvironment = (typeof FLAG_ENVIRONMENTS)[number];

export type FlagValue = boolean | string | number;

export type FlagSpec =
  | { readonly type: 'boolean' }
  | { readonly type: 'enum'; readonly values: readonly string[] }
  | { readonly type: 'integer'; readonly min: number; readonly max: number };

export interface FlagDeclaration {
  readonly product: FlagProduct;
  readonly key: string;
  readonly owner: string;
  readonly spec: FlagSpec;
  readonly default: FlagValue;
}

export type FlagErrorCode =
  | 'INVALID_DECLARATION'
  | 'UNDECLARED_FLAG'
  | 'INVALID_REQUEST'
  | 'FORBIDDEN_FIELD'
  | 'INVALID_VALUE'
  | 'INVALID_TARGETING'
  | 'STALE_REVISION'
  | 'UNKNOWN_REVISION'
  | 'ROLLBACK_REFUSED'
  | 'STORE_UNAVAILABLE'
  | 'INVALID_CONFIGURATION';

export class FlagError extends Error {
  readonly code: FlagErrorCode;
  constructor(code: FlagErrorCode, message: string) {
    super(message);
    this.name = 'FlagError';
    this.code = code;
  }
}

const KEY_RE = /^[a-z][a-z0-9_]{0,63}$/;
const COHORT_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INTEGER_DIGITS_RE = /^-?[0-9]{1,15}$/;
const MAX_ABS_INTEGER = 1e15;
const ROLLOUT_BUCKETS = 100;
const REQUEST_FIELDS = ['product', 'environment', 'key'] as const;

// ---------------------------------------------------------------- declarations and registry

export function isValidValue(spec: FlagSpec, value: unknown): value is FlagValue {
  switch (spec.type) {
    case 'boolean':
      return typeof value === 'boolean';
    case 'enum':
      return typeof value === 'string' && spec.values.includes(value);
    case 'integer':
      return (
        typeof value === 'number' &&
        Number.isSafeInteger(value) &&
        Math.abs(value) < MAX_ABS_INTEGER &&
        value >= spec.min &&
        value <= spec.max
      );
  }
}

function validateSpec(spec: FlagSpec): void {
  if (spec.type === 'boolean') return;
  if (spec.type === 'enum') {
    const n = spec.values.length;
    const ok =
      n >= 1 &&
      n <= 100 &&
      spec.values.every((v) => typeof v === 'string' && v.length >= 1 && v.length <= 64) &&
      new Set(spec.values).size === n;
    if (!ok) throw new FlagError('INVALID_DECLARATION', 'enum needs 1 to 100 distinct strings of 1 to 64 characters');
    return;
  }
  const ok =
    Number.isSafeInteger(spec.min) &&
    Number.isSafeInteger(spec.max) &&
    Math.abs(spec.min) < MAX_ABS_INTEGER &&
    Math.abs(spec.max) < MAX_ABS_INTEGER &&
    spec.min <= spec.max;
  if (!ok) throw new FlagError('INVALID_DECLARATION', 'integer bounds must be integers with min <= max');
}

/** The JSON stored in titan.feature_flags.allowed_values for a declared type. */
export function allowedValuesJson(spec: FlagSpec): unknown {
  if (spec.type === 'boolean') return [true, false];
  if (spec.type === 'enum') return [...spec.values];
  return { min: spec.min, max: spec.max };
}

export interface FlagRegistry {
  get(product: FlagProduct, key: string): FlagDeclaration;
  list(): readonly FlagDeclaration[];
}

/** Builds the registry. Rejects an invalid declaration, a default outside its type, or a duplicate key. */
export function createFlagRegistry(declarations: readonly FlagDeclaration[]): FlagRegistry {
  const byId = new Map<string, FlagDeclaration>();
  for (const d of declarations) {
    if (!(FLAG_PRODUCTS as readonly string[]).includes(d.product)) {
      throw new FlagError('INVALID_DECLARATION', `unknown product ${String(d.product)}`);
    }
    if (!KEY_RE.test(d.key)) throw new FlagError('INVALID_DECLARATION', `invalid flag key ${d.key}`);
    const owner = d.owner.trim();
    if (owner.length < 1 || owner.length > 200) throw new FlagError('INVALID_DECLARATION', `flag ${d.key} needs an owner`);
    validateSpec(d.spec);
    if (!isValidValue(d.spec, d.default)) {
      throw new FlagError('INVALID_DECLARATION', `default for ${d.product}.${d.key} is not valid for its type`);
    }
    const id = `${d.product}\u0000${d.key}`;
    if (byId.has(id)) throw new FlagError('INVALID_DECLARATION', `duplicate flag ${d.product}.${d.key}`);
    byId.set(id, { ...d, owner });
  }
  return {
    get(product, key) {
      const d = byId.get(`${product}\u0000${key}`);
      if (!d) throw new FlagError('UNDECLARED_FLAG', `flag ${product}.${key} is not declared`);
      return d;
    },
    list() {
      return [...byId.values()];
    },
  };
}

// ---------------------------------------------------------------- verified context

/** Brand that only trustVerifiedContext sets. The resolver refuses any context without it. */
export const VERIFIED_CONTEXT: unique symbol = Symbol('verified-service-context');

export interface VerifiedContext {
  readonly organisationId: string | null;
  readonly cohorts: readonly string[];
  readonly [VERIFIED_CONTEXT]: true;
}

/**
 * Builds the context the resolver trusts. Call only from the authentication layer, after the
 * caller's token or mTLS identity has been verified, and take organisationId from those verified
 * claims. Nothing in a request body or query string may be passed here.
 */
export function trustVerifiedContext(input: { organisationId: string | null; cohorts?: readonly string[] }): VerifiedContext {
  if (input.organisationId !== null && !UUID_RE.test(input.organisationId)) {
    throw new FlagError('INVALID_REQUEST', 'verified organisation id must be a UUID or null');
  }
  const cohorts = [...(input.cohorts ?? [])];
  if (!cohorts.every((c) => COHORT_RE.test(c))) throw new FlagError('INVALID_REQUEST', 'invalid cohort name');
  return { organisationId: input.organisationId, cohorts, [VERIFIED_CONTEXT]: true };
}

function assertVerified(ctx: VerifiedContext): void {
  if (!ctx || ctx[VERIFIED_CONTEXT] !== true) {
    throw new FlagError('INVALID_REQUEST', 'resolver needs a verified context from trustVerifiedContext');
  }
}

// ---------------------------------------------------------------- store port

export interface FlagScope {
  readonly product: FlagProduct;
  readonly environment: FlagEnvironment;
  readonly flagKey: string;
  readonly organisationId: string | null;
}

/** One titan.feature_flags row. `allowed`, `defaultValue` and `value` are JSON values from the store. */
export interface FlagRow extends FlagScope {
  readonly flagType: FlagSpec['type'];
  readonly allowed: unknown;
  readonly defaultValue: unknown;
  readonly owner: string;
  readonly value: unknown;
  readonly rolloutPercent: number | null;
  readonly cohort: string | null;
  readonly expiresAt: Date | null;
  readonly revision: number;
}

export interface FlagSnapshot {
  readonly flagType: FlagSpec['type'];
  readonly allowed: unknown;
  readonly defaultValue: unknown;
  readonly owner: string;
  readonly value: unknown;
  readonly rolloutPercent: number | null;
  readonly cohort: string | null;
  readonly expiresAt: string | null;
}

export interface HistoryEntry {
  readonly scope: FlagScope;
  readonly revision: number;
  readonly action: 'create' | 'set' | 'rollback';
  readonly rollbackToRevision: number | null;
  readonly snapshot: FlagSnapshot;
  readonly actor: string;
  readonly reason: string;
}

/**
 * Storage port. readScopes returns the global row and, when organisationId is set, that
 * organisation's row, and nothing else. commit must apply `next` only if the stored revision is
 * still expectedRevision (0 for a scope that does not exist yet), and must record `entry` in the
 * same transaction. It throws FlagError('STALE_REVISION') when the revision has moved.
 */
export interface FlagStore {
  readScopes(query: FlagScope): Promise<readonly FlagRow[]>;
  readHistory(scope: FlagScope, revision: number): Promise<HistoryEntry | null>;
  commit(input: { scope: FlagScope; expectedRevision: number; next: FlagRow; entry: HistoryEntry }): Promise<void>;
}

export interface FlagDeps {
  readonly registry: FlagRegistry;
  readonly store: FlagStore;
  readonly now?: () => Date;
  /** Store read deadline. A read that takes longer resolves to the declared default. */
  readonly storeTimeoutMs?: number;
}

const now = (deps: FlagDeps): Date => (deps.now ? deps.now() : new Date());

// ---------------------------------------------------------------- deterministic bucketing

/** Stable bucket 0..99 for (organisation, flag). Same inputs always give the same bucket. */
export function rolloutBucket(organisationId: string, flagKey: string): number {
  const digest = createHash('sha256').update(`${organisationId}\u0000${flagKey}`).digest();
  return digest.readUInt32BE(0) % ROLLOUT_BUCKETS;
}

// ---------------------------------------------------------------- resolver

export type FlagSource = 'override' | 'cohort' | 'rollout' | 'global' | 'default' | 'fallback';

export interface FlagResolution {
  readonly value: FlagValue;
  readonly source: FlagSource;
  readonly revision: number | null;
  readonly reason?: 'store-unavailable' | 'invalid-configuration';
}

export interface FlagRequest {
  readonly product: FlagProduct;
  readonly environment: FlagEnvironment;
  readonly key: string;
}

function sameJson(a: unknown, b: unknown): boolean {
  return canonical(a) === canonical(b);
}

function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

class InvalidConfiguration extends Error {}

/** Checks one stored row against its declaration. Throws InvalidConfiguration on any mismatch. */
function checkRow(decl: FlagDeclaration, row: FlagRow, expected: FlagScope): void {
  const scopeOk =
    row.product === expected.product &&
    row.environment === expected.environment &&
    row.flagKey === expected.flagKey &&
    row.organisationId === expected.organisationId;
  if (!scopeOk) throw new InvalidConfiguration('row scope does not match the request');
  if (row.flagType !== decl.spec.type || !sameJson(row.allowed, allowedValuesJson(decl.spec))) {
    throw new InvalidConfiguration('stored type does not match the declaration');
  }
  if (!sameJson(row.defaultValue, decl.default) || row.owner !== decl.owner) {
    throw new InvalidConfiguration('stored default or owner does not match the declaration');
  }
  if (!isValidValue(decl.spec, row.value)) throw new InvalidConfiguration('stored value is not valid for its type');
  if (row.rolloutPercent !== null && !(Number.isInteger(row.rolloutPercent) && row.rolloutPercent >= 0 && row.rolloutPercent <= 100)) {
    throw new InvalidConfiguration('stored rollout is out of range');
  }
  if (row.organisationId !== null && (row.rolloutPercent !== null || row.cohort !== null || row.expiresAt === null)) {
    throw new InvalidConfiguration('override row must have an expiry and no targeting');
  }
  if (row.rolloutPercent !== null && row.cohort !== null) {
    throw new InvalidConfiguration('a row has at most one targeting rule');
  }
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new FlagError('STORE_UNAVAILABLE', 'store read timed out')), ms);
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

/**
 * Resolves the value of one flag for the verified organisation. The request may carry only
 * product, environment and key. An organisation or tenant field in the request is refused, so the
 * organisation can only come from the verified context.
 */
export async function resolveFlag(deps: FlagDeps, request: FlagRequest, context: VerifiedContext): Promise<FlagResolution> {
  for (const field of Object.keys(request)) {
    if (!(REQUEST_FIELDS as readonly string[]).includes(field)) {
      throw new FlagError('FORBIDDEN_FIELD', `request field ${field} is not accepted; targeting comes from the verified context`);
    }
  }
  assertVerified(context);
  if (!(FLAG_PRODUCTS as readonly string[]).includes(request.product)) throw new FlagError('INVALID_REQUEST', 'unknown product');
  if (!(FLAG_ENVIRONMENTS as readonly string[]).includes(request.environment)) throw new FlagError('INVALID_REQUEST', 'unknown environment');
  const decl = deps.registry.get(request.product, request.key);
  const org = context.organisationId;
  const scope: FlagScope = { product: request.product, environment: request.environment, flagKey: request.key, organisationId: org };
  const fallback = (reason: NonNullable<FlagResolution['reason']>): FlagResolution => ({
    value: decl.default,
    source: 'fallback',
    revision: null,
    reason,
  });

  let rows: unknown;
  try {
    rows = await withTimeout(
      Promise.resolve().then(() => deps.store.readScopes({ product: scope.product, environment: scope.environment, flagKey: scope.flagKey, organisationId: org })),
      deps.storeTimeoutMs ?? 1000,
    );
  } catch {
    return fallback('store-unavailable');
  }

  try {
    if (!Array.isArray(rows)) throw new InvalidConfiguration('store did not return a list');
    const typed = rows as FlagRow[];
    for (const row of typed) {
      if (row.organisationId !== null && row.organisationId !== org) throw new InvalidConfiguration('row belongs to another organisation');
      checkRow(decl, row, { ...scope, organisationId: row.organisationId });
    }
    const at = now(deps).getTime();
    const active = (row: FlagRow | undefined): row is FlagRow => row !== undefined && (row.expiresAt === null || row.expiresAt.getTime() > at);

    const orgRow = org === null ? undefined : typed.find((r) => r.organisationId === org);
    if (active(orgRow)) {
      return { value: orgRow.value as FlagValue, source: 'override', revision: orgRow.revision };
    }
    const globalRow = typed.find((r) => r.organisationId === null);
    if (active(globalRow)) {
      if (globalRow.cohort !== null) {
        if (context.cohorts.includes(globalRow.cohort)) {
          return { value: globalRow.value as FlagValue, source: 'cohort', revision: globalRow.revision };
        }
      } else if (globalRow.rolloutPercent !== null) {
        if (org !== null && rolloutBucket(org, decl.key) < globalRow.rolloutPercent) {
          return { value: globalRow.value as FlagValue, source: 'rollout', revision: globalRow.revision };
        }
      } else {
        return { value: globalRow.value as FlagValue, source: 'global', revision: globalRow.revision };
      }
    }
    return { value: decl.default, source: 'default', revision: globalRow?.revision ?? null };
  } catch (err) {
    if (err instanceof InvalidConfiguration) return fallback('invalid-configuration');
    throw err;
  }
}

// ---------------------------------------------------------------- change and rollback

export interface FlagChange {
  readonly product: FlagProduct;
  readonly environment: FlagEnvironment;
  readonly key: string;
  /** null for the global scope, otherwise the organisation the override applies to. */
  readonly organisationId: string | null;
  /** The revision the caller last read. 0 means the scope does not exist yet. */
  readonly expectedRevision: number;
  readonly value: FlagValue;
  readonly rolloutPercent?: number | null;
  readonly cohort?: string | null;
  /** Required for an organisation override. Must be in the future. */
  readonly expiresAt?: Date | null;
  readonly actor: string;
  readonly reason: string;
}

export interface RollbackRequest {
  readonly product: FlagProduct;
  readonly environment: FlagEnvironment;
  readonly key: string;
  readonly organisationId: string | null;
  readonly expectedRevision: number;
  /** The history revision whose values are restored. */
  readonly toRevision: number;
  readonly actor: string;
  readonly reason: string;
}

function cleanText(label: string, value: string, max: number): string {
  const v = value.trim();
  if (v.length < 1 || v.length > max) throw new FlagError('INVALID_REQUEST', `${label} must be 1 to ${max} characters`);
  return v;
}

function assertScopeInput(product: string, environment: string, org: string | null): void {
  if (!(FLAG_PRODUCTS as readonly string[]).includes(product)) throw new FlagError('INVALID_REQUEST', 'unknown product');
  if (!(FLAG_ENVIRONMENTS as readonly string[]).includes(environment)) throw new FlagError('INVALID_REQUEST', 'unknown environment');
  if (org !== null && !UUID_RE.test(org)) throw new FlagError('INVALID_REQUEST', 'organisation id must be a UUID or null');
}

function assertRevision(n: number): void {
  if (!Number.isSafeInteger(n) || n < 0) throw new FlagError('INVALID_REQUEST', 'revision must be a non-negative integer');
}

async function currentRow(deps: FlagDeps, decl: FlagDeclaration, scope: FlagScope): Promise<FlagRow | undefined> {
  const rows = await deps.store.readScopes({ product: scope.product, environment: scope.environment, flagKey: scope.flagKey, organisationId: scope.organisationId });
  const row = rows.find((r) => r.organisationId === scope.organisationId);
  if (row) checkRow(decl, row, scope);
  return row;
}

async function writeScope(
  deps: FlagDeps,
  decl: FlagDeclaration,
  scope: FlagScope,
  expectedRevision: number,
  fields: { value: FlagValue | unknown; rolloutPercent: number | null; cohort: string | null; expiresAt: Date | null },
  action: HistoryEntry['action'],
  rollbackToRevision: number | null,
  actor: string,
  reason: string,
): Promise<number> {
  const existing = await currentRow(deps, decl, scope);
  const currentRevision = existing?.revision ?? 0;
  if (currentRevision !== expectedRevision) {
    throw new FlagError('STALE_REVISION', `expected revision ${expectedRevision} but the scope is at ${currentRevision}`);
  }
  const revision = expectedRevision + 1;
  const next: FlagRow = {
    ...scope,
    flagType: decl.spec.type,
    allowed: allowedValuesJson(decl.spec),
    defaultValue: decl.default,
    owner: decl.owner,
    value: fields.value,
    rolloutPercent: fields.rolloutPercent,
    cohort: fields.cohort,
    expiresAt: fields.expiresAt,
    revision,
  };
  const entry: HistoryEntry = {
    scope,
    revision,
    action,
    rollbackToRevision,
    snapshot: snapshotOf(next),
    actor,
    reason,
  };
  await deps.store.commit({ scope, expectedRevision, next, entry });
  return revision;
}

function snapshotOf(row: FlagRow): FlagSnapshot {
  return {
    flagType: row.flagType,
    allowed: row.allowed,
    defaultValue: row.defaultValue,
    owner: row.owner,
    value: row.value,
    rolloutPercent: row.rolloutPercent,
    cohort: row.cohort,
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
  };
}

/** Sets a flag scope to a new value. Refuses a stale expected revision. Returns the new revision. */
export async function changeFlag(deps: FlagDeps, change: FlagChange): Promise<number> {
  assertScopeInput(change.product, change.environment, change.organisationId);
  assertRevision(change.expectedRevision);
  const actor = cleanText('actor', change.actor, 200);
  const reason = cleanText('reason', change.reason, 500);
  const decl = deps.registry.get(change.product, change.key);
  if (!isValidValue(decl.spec, change.value)) throw new FlagError('INVALID_VALUE', `value is not valid for ${decl.key}`);

  const rolloutPercent = change.rolloutPercent ?? null;
  const cohort = change.cohort ?? null;
  const expiresAt = change.expiresAt ?? null;
  if (rolloutPercent !== null && !(Number.isInteger(rolloutPercent) && rolloutPercent >= 0 && rolloutPercent <= 100)) {
    throw new FlagError('INVALID_TARGETING', 'rollout percentage must be an integer from 0 to 100');
  }
  if (cohort !== null && !COHORT_RE.test(cohort)) throw new FlagError('INVALID_TARGETING', 'invalid cohort name');
  if (rolloutPercent !== null && cohort !== null) throw new FlagError('INVALID_TARGETING', 'choose a cohort or a rollout, not both');
  if (change.organisationId !== null) {
    if (rolloutPercent !== null || cohort !== null) throw new FlagError('INVALID_TARGETING', 'an organisation override takes no rollout or cohort');
    if (expiresAt === null) throw new FlagError('INVALID_TARGETING', 'an organisation override needs expiresAt');
  }
  if (expiresAt !== null && !(expiresAt.getTime() > now(deps).getTime())) {
    throw new FlagError('INVALID_TARGETING', 'expiresAt must be in the future');
  }

  const scope: FlagScope = { product: change.product, environment: change.environment, flagKey: change.key, organisationId: change.organisationId };
  return writeScope(
    deps, decl, scope, change.expectedRevision,
    { value: change.value, rolloutPercent, cohort, expiresAt },
    change.expectedRevision === 0 ? 'create' : 'set', null, actor, reason,
  );
}

/**
 * Restores the values recorded at toRevision as a new revision, recorded with action 'rollback'.
 * Refuses an unknown revision, a snapshot whose expiry has passed, and a stale expected revision.
 */
export async function rollbackFlag(deps: FlagDeps, req: RollbackRequest): Promise<number> {
  assertScopeInput(req.product, req.environment, req.organisationId);
  assertRevision(req.expectedRevision);
  assertRevision(req.toRevision);
  if (req.toRevision < 1) throw new FlagError('INVALID_REQUEST', 'toRevision must be at least 1');
  const actor = cleanText('actor', req.actor, 200);
  const reason = cleanText('reason', req.reason, 500);
  const decl = deps.registry.get(req.product, req.key);
  const scope: FlagScope = { product: req.product, environment: req.environment, flagKey: req.key, organisationId: req.organisationId };

  const past = await deps.store.readHistory(scope, req.toRevision);
  if (!past) throw new FlagError('UNKNOWN_REVISION', `no history revision ${req.toRevision} for this scope`);
  const snap = past.snapshot;
  const expiresAt = snap.expiresAt === null ? null : new Date(snap.expiresAt);
  if (req.organisationId !== null && expiresAt === null) {
    throw new FlagError('ROLLBACK_REFUSED', 'cannot roll back to an override without an expiry');
  }
  if (expiresAt !== null && !(expiresAt.getTime() > now(deps).getTime())) {
    throw new FlagError('ROLLBACK_REFUSED', 'cannot roll back to a revision whose expiry has passed');
  }
  const restored = { flagType: decl.spec.type, owner: decl.owner, defaultValue: decl.default, allowed: allowedValuesJson(decl.spec) };
  if (snap.flagType !== restored.flagType || snap.owner !== restored.owner || !sameJson(snap.allowed, restored.allowed) || !sameJson(snap.defaultValue, restored.defaultValue)) {
    throw new FlagError('ROLLBACK_REFUSED', 'the recorded revision was made under a different declaration');
  }
  if (!isValidValue(decl.spec, snap.value)) throw new FlagError('ROLLBACK_REFUSED', 'the recorded value is no longer valid for its declaration');

  return writeScope(
    deps, decl, scope, req.expectedRevision,
    { value: snap.value, rolloutPercent: snap.rolloutPercent, cohort: snap.cohort, expiresAt },
    'rollback', req.toRevision, actor, reason,
  );
}
