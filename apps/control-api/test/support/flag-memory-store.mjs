// In-memory FlagStore for control-api tests. It uses the same commit rule as the database: the stored
// revision must equal the expected revision, and every commit appends one history entry.
import { FlagError } from '../../../../packages/control-plane/dist/feature-flags.js';

const keyOf = s => JSON.stringify([s.product, s.environment, s.flagKey, s.organisationId ?? null]);

export function memoryFlagStore() {
  const current = new Map();
  const history = [];
  const store = {
    current,
    history,
    reads: 0,
    commits: 0,
    failReads: false,
    failCommits: false,
    /** Every organisation the store was asked about, to prove which scope a request used. */
    queriedOrganisations: [],
    async readScopes(q) {
      store.reads++;
      store.queriedOrganisations.push(q.organisationId);
      if (store.failReads) throw new Error('connection refused');
      return [...current.values()]
        .filter(r => r.product === q.product && r.environment === q.environment && r.flagKey === q.flagKey
          && (r.organisationId === null || r.organisationId === q.organisationId))
        .map(r => ({ ...r }));
    },
    async readHistory(scope, revision) {
      const e = history.find(h => keyOf(h.scope) === keyOf(scope) && h.revision === revision);
      return e ? structuredClone(e) : null;
    },
    async commit({ scope, expectedRevision, next, entry }) {
      if (store.failCommits) throw new Error('database unavailable');
      const cur = current.get(keyOf(scope));
      const rev = cur ? cur.revision : 0;
      if (rev !== expectedRevision) throw new FlagError('STALE_REVISION', `stored revision ${rev}`);
      store.commits++;
      current.set(keyOf(scope), { ...next });
      history.push(structuredClone(entry));
    },
  };
  return store;
}

/** Builds a stored row that matches the declaration, so the resolver accepts it. */
export function seedRow(registry, { product, environment, key, organisationId = null, value, rolloutPercent = null, cohort = null, expiresAt = null, revision = 1 }, store) {
  const decl = registry.get(product, key);
  const row = {
    product, environment, flagKey: key, organisationId,
    flagType: decl.spec.type,
    allowed: decl.spec.type === 'boolean' ? [true, false]
      : decl.spec.type === 'enum' ? [...decl.spec.values]
        : { min: decl.spec.min, max: decl.spec.max },
    defaultValue: decl.default,
    owner: decl.owner,
    value, rolloutPercent, cohort, expiresAt, revision,
  };
  store.current.set(keyOf(row), row);
  return row;
}
