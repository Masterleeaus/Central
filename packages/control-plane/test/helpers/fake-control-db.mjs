// TEST ONLY. Routes the SQL that CentralProvisioner, withCentralReadSnapshot and PostgresEntitlementReader send,
// against in-memory tables with the same revision, conflict and rollback semantics. Unrouted SQL throws.
export function fakeControlDb({ memberships = [], entitlements = [] } = {}) {
  const state = {
    entitlements: entitlements.map(e => ({ features: [], expires_at: null, revision: 1, state: 'active', ...e })),
    memberships: [...memberships],
    audit: [],
    revocations: new Map(),
  };
  let snapshot = null;
  let armed = null;
  const clone = () => ({ entitlements: structuredClone(state.entitlements), audit: structuredClone(state.audit), revocations: new Map(state.revocations) });
  const restore = (s) => { state.entitlements = s.entitlements; state.audit = s.audit; state.revocations = s.revocations; };
  const log = [];
  const route = (text, p) => {
    if (/^BEGIN/.test(text)) { snapshot = clone(); return { rows: [], rowCount: 0 }; }
    if (/^COMMIT/.test(text)) { snapshot = null; return { rows: [], rowCount: 0 }; }
    if (/^ROLLBACK/.test(text)) { if (snapshot) restore(snapshot); snapshot = null; return { rows: [], rowCount: 0 }; }
    if (/^SET LOCAL (ROLE|statement_timeout)|^SELECT pg_advisory_xact_lock|^SELECT set_config/.test(text)) return { rows: [], rowCount: 0 };
    if (text.startsWith('SELECT command_kind')) { const rows = state.audit.filter(a => a.request_id === p[0]); return { rows, rowCount: rows.length }; }
    if (text.startsWith('INSERT INTO titan.entitlements')) {
      const [id, org, app, features, expiresAt] = p;
      if (state.entitlements.some(e => e.id === id || (e.organisation_id === org && e.application_id === app))) return { rows: [], rowCount: 0 };
      state.entitlements.push({ id, organisation_id: org, application_id: app, state: 'active', features, expires_at: expiresAt, revision: 1 });
      return { rows: [{ id }], rowCount: 1 };
    }
    if (text.startsWith('SELECT organisation_id, application_id, revision, features, expires_at FROM titan.entitlements')) {
      const rows = state.entitlements.filter(e => e.id === p[0]).map(({ organisation_id, application_id, revision, features, expires_at }) => ({ organisation_id, application_id, revision, features, expires_at }));
      return { rows, rowCount: rows.length };
    }
    if (text.startsWith('UPDATE titan.entitlements SET state=$3, features=$4, expires_at=$5')) {
      const row = state.entitlements.find(e => e.id === p[0] && e.revision === p[1]);
      if (!row) return { rows: [], rowCount: 0 };
      Object.assign(row, { state: p[2], features: p[3], expires_at: p[4], revision: row.revision + 1 });
      return { rows: [], rowCount: 1 };
    }
    if (text.startsWith('SELECT i.logto_subject, m.organisation_id FROM titan.memberships')) {
      const rows = state.memberships.filter(m => m.organisation_id === p[0]);
      return { rows, rowCount: rows.length };
    }
    if (text.startsWith('INSERT INTO titan.titan_session_revocations')) {
      const key = `${p[0]}|${p[1]}|${p[2]}`;
      const generation = (state.revocations.get(key) ?? 0) + 1;
      state.revocations.set(key, generation);
      return { rows: [{ generation }], rowCount: 1 };
    }
    if (text.startsWith('INSERT INTO titan.provisioning_audit')) {
      state.audit.push({ request_id: p[0], actor_subject: p[1], command_kind: p[3], command_digest: p[4], subject_id: p[5] });
      return { rows: [], rowCount: 1 };
    }
    if (text.startsWith('SELECT id, organisation_id, application_id, state, features, expires_at, revision FROM titan.entitlements WHERE organisation_id')) {
      const rows = state.entitlements
        .filter(e => e.organisation_id === p[0] && e.application_id === p[1])
        .map(e => ({ id: e.id, organisation_id: e.organisation_id, application_id: e.application_id, state: e.state, features: e.features, expires_at: e.expires_at, revision: e.revision }));
      return { rows, rowCount: rows.length };
    }
    throw Error(`unrouted SQL in fake control db: ${text.slice(0, 80)}`);
  };
  const pool = {
    async connect() {
      return {
        async query(text, params = []) {
          log.push(text);
          if (armed && armed.match.test(text)) { const e = armed.error; armed = null; throw e; }
          return route(text, params);
        },
        release() {},
      };
    },
  };
  return {
    pool, state, log,
    /** Fails the next statement whose text matches. */
    failNext(match, error = Error('injected database failure')) { armed = { match, error }; },
    revocationsFor(app, sub, org) { return state.revocations.get(`${app}|${sub}|${org}`) ?? 0; },
  };
}
