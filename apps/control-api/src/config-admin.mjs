/** Operator change path for feature flags (issue #38, docs/CONFIG.md section 5).
 * Reached only through the operator admin handler in admin.mjs, which has already checked the bearer
 * token and the Logto operator authority. The actor recorded in history is the verified operator subject;
 * no actor, requester or reason-of-record field is accepted from the body. */
import { FlagError, changeFlag, rollbackFlag } from '../../../packages/control-plane/dist/feature-flags.js';

export const FLAG_CHANGE_PATH = '/v1/admin/flags/change';

const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const uuid = v => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const revision = v => Number.isSafeInteger(v) && v >= 0;
const text = (v, max) => typeof v === 'string' && v.trim().length >= 1 && v.length <= max;
const COMMON = ['op', 'product', 'environment', 'key', 'organisationId', 'expectedRevision', 'reason'];
const SET_FIELDS = [...COMMON, 'value', 'rolloutPercent', 'cohort', 'expiresAt'];
const ROLLBACK_FIELDS = [...COMMON, 'toRevision'];

/**
 * Validates a change body and returns a normalised command, or null. Allowed fields only: an unknown
 * field, including any `actor`, makes the whole body invalid. changeFlag and rollbackFlag still check
 * the product, environment, key, value and targeting against the registry and the scope rules.
 */
export function parseFlagChange(body) {
  if (!isObject(body) || typeof body.op !== 'string') return null;
  const allowed = body.op === 'set' ? SET_FIELDS : body.op === 'rollback' ? ROLLBACK_FIELDS : null;
  if (!allowed || !Object.keys(body).every(k => allowed.includes(k))) return null;
  if (typeof body.product !== 'string' || typeof body.environment !== 'string' || typeof body.key !== 'string') return null;
  if (body.organisationId !== null && !uuid(body.organisationId)) return null;
  if (!revision(body.expectedRevision) || !text(body.reason, 500)) return null;
  const common = {
    product: body.product,
    environment: body.environment,
    key: body.key,
    organisationId: body.organisationId,
    expectedRevision: body.expectedRevision,
    reason: body.reason,
  };
  if (body.op === 'rollback') {
    if (!Number.isSafeInteger(body.toRevision) || body.toRevision < 1) return null;
    return { op: 'rollback', ...common, toRevision: body.toRevision };
  }
  if (!(typeof body.value === 'boolean' || typeof body.value === 'string' || typeof body.value === 'number')) return null;
  if (body.rolloutPercent !== undefined && body.rolloutPercent !== null && !Number.isSafeInteger(body.rolloutPercent)) return null;
  if (body.cohort !== undefined && body.cohort !== null && typeof body.cohort !== 'string') return null;
  let expiresAt = null;
  if (body.expiresAt !== undefined && body.expiresAt !== null) {
    if (typeof body.expiresAt !== 'string' || body.expiresAt.length > 40 || !Number.isFinite(Date.parse(body.expiresAt))) return null;
    expiresAt = new Date(body.expiresAt);
  }
  return {
    op: 'set',
    ...common,
    value: body.value,
    rolloutPercent: body.rolloutPercent ?? null,
    cohort: body.cohort ?? null,
    expiresAt,
  };
}

/**
 * Returns async (command, actorSubject) => revision. The actor must be the verified operator subject.
 * deps are the same registry and store the read endpoint uses.
 */
export function createFlagChangeHandler({ registry, store, now }) {
  if (!registry || !store) throw new Error('flag registry and store required');
  return async (command, actorSubject) => {
    if (typeof actorSubject !== 'string' || actorSubject.length < 1) throw new Error('verified operator subject required');
    const deps = { registry, store, now };
    if (command.op === 'rollback') {
      return rollbackFlag(deps, {
        product: command.product,
        environment: command.environment,
        key: command.key,
        organisationId: command.organisationId,
        expectedRevision: command.expectedRevision,
        toRevision: command.toRevision,
        actor: actorSubject,
        reason: command.reason,
      });
    }
    return changeFlag(deps, {
      product: command.product,
      environment: command.environment,
      key: command.key,
      organisationId: command.organisationId,
      expectedRevision: command.expectedRevision,
      value: command.value,
      rolloutPercent: command.rolloutPercent,
      cohort: command.cohort,
      expiresAt: command.expiresAt,
      actor: actorSubject,
      reason: command.reason,
    });
  };
}

/** HTTP status for a flag error. Codes are returned to the operator; no values or stored rows are. */
export function flagErrorStatus(error) {
  if (!(error instanceof FlagError)) return null;
  switch (error.code) {
    case 'UNDECLARED_FLAG': return 404;
    case 'STALE_REVISION': return 409;
    case 'INVALID_REQUEST':
    case 'INVALID_VALUE':
    case 'INVALID_TARGETING':
    case 'UNKNOWN_REVISION':
    case 'ROLLBACK_REFUSED':
    case 'FORBIDDEN_FIELD':
      return 400;
    default: return null;
  }
}
