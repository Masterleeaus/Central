// TEST ONLY. An in-memory stand-in for titan.outbox_events and titan.outbox_event_audit.
// It answers the SQL that outbox.ts (writer), outbox-publisher.ts (claim, mark, replay) and the audit inserts send,
// with the same state rules as migration 0012: head-of-line order per tenant, attempt limit, dead letters,
// operator replay, and rollback of a transaction. Anything unrouted throws, so a new SQL statement fails loudly.
import { randomUUID } from 'node:crypto';

export function memoryOutboxStore({ startMs = Date.parse('2026-11-15T00:00:00Z') } = {}) {
  const state = { rows: [], audit: [], seq: 0 };
  const clock = { ms: startMs };
  let snapshot = null;

  const clone = () => structuredClone(state);
  const restore = (s) => { state.rows = s.rows; state.audit = s.audit; state.seq = s.seq; };
  const iso = (ms) => new Date(ms).toISOString();

  function claimDue(maxAttempts, batchSize, leaseSeconds) {
    const pending = state.rows.filter((r) => r.status === 'pending');
    const due = pending.filter((r) => r.next_attempt_at <= clock.ms && r.attempts < maxAttempts)
      .filter((r) => !pending.some((e) => e.organisation_id === r.organisation_id && e.seq < r.seq))
      .sort((a, b) => a.next_attempt_at - b.next_attempt_at || a.seq - b.seq)
      .slice(0, batchSize);
    for (const r of due) {
      r.attempts += 1;
      r.next_attempt_at = clock.ms + leaseSeconds * 1000;
    }
    return due;
  }

  function route(text, v = []) {
    if (/^BEGIN/.test(text)) { snapshot = clone(); return { rows: [], rowCount: 0 }; }
    if (/^COMMIT/.test(text)) { snapshot = null; return { rows: [], rowCount: 0 }; }
    if (/^ROLLBACK/.test(text)) { if (snapshot) restore(snapshot); snapshot = null; return { rows: [], rowCount: 0 }; }

    if (text.includes('INSERT INTO titan.outbox_events')) {
      const [organisation_id, source_product, event_type, schema_version, correlation_id, idempotency_key, payload, payload_digest] = v;
      if (state.rows.some((r) => r.idempotency_key === idempotency_key)) return { rows: [], rowCount: 0 };
      state.seq += 1;
      const row = { id: randomUUID(), seq: state.seq, organisation_id, source_product, event_type, schema_version: Number(schema_version),
        correlation_id, idempotency_key, payload: JSON.parse(payload), payload_digest, status: 'pending', attempts: 0,
        next_attempt_at: clock.ms, created_at: iso(clock.ms), published_at: null, last_error: null };
      state.rows.push(row);
      return { rows: [{ id: row.id }], rowCount: 1 };
    }
    if (text.includes('SELECT organisation_id, source_product, event_type, schema_version, payload_digest')) {
      const r = state.rows.find((x) => x.idempotency_key === v[0]);
      return { rows: r ? [{ organisation_id: r.organisation_id, source_product: r.source_product, event_type: r.event_type,
        schema_version: r.schema_version, payload_digest: r.payload_digest }] : [], rowCount: r ? 1 : 0 };
    }
    if (text.includes('lease expired after final attempt') && text.includes("SET status = 'dead'")) {
      const hit = state.rows.filter((r) => r.status === 'pending' && r.next_attempt_at <= clock.ms && r.attempts >= v[0]);
      for (const r of hit) { r.status = 'dead'; r.last_error = 'lease expired after final attempt'; }
      return { rows: hit.map((r) => ({ id: r.id, organisation_id: r.organisation_id })), rowCount: hit.length };
    }
    if (text.includes('WITH due AS')) {
      const due = claimDue(v[0], v[1], v[2]);
      return { rows: due.map((r) => ({ ...r })), rowCount: due.length };
    }
    if (text.includes("SET status = 'published'")) {
      const r = state.rows.find((x) => x.id === v[0] && x.status === 'pending');
      if (!r) return { rows: [], rowCount: 0 };
      Object.assign(r, { status: 'published', published_at: iso(clock.ms), last_error: null });
      return { rows: [{ id: r.id }], rowCount: 1 };
    }
    if (text.includes('SELECT attempts FROM titan.outbox_events')) {
      const r = state.rows.find((x) => x.id === v[0] && x.status === 'pending');
      return { rows: r ? [{ attempts: r.attempts }] : [], rowCount: r ? 1 : 0 };
    }
    if (text.includes('SET status = $2')) {
      const r = state.rows.find((x) => x.id === v[0]);
      Object.assign(r, { status: v[1], next_attempt_at: clock.ms + Number(v[2]) * 1000, last_error: v[3] });
      return { rows: [], rowCount: 1 };
    }
    if (text.includes("SET status = 'pending', attempts = 0")) {
      const r = state.rows.find((x) => x.id === v[0] && x.status === 'dead');
      if (!r) return { rows: [], rowCount: 0 };
      Object.assign(r, { status: 'pending', attempts: 0, next_attempt_at: clock.ms });
      return { rows: [{ organisation_id: r.organisation_id }], rowCount: 1 };
    }
    if (text.includes('INSERT INTO titan.outbox_event_audit')) {
      const action = /'(published|attempt_failed|dead|operator_replay)'/.exec(text)?.[1];
      if (!action) throw new Error('audit action not recognised');
      state.audit.push({ event_id: v[0], organisation_id: v[1], action, actor: v[2], detail: v[3] ?? null, at: clock.ms });
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`memory outbox store: unrouted SQL: ${text.trim().slice(0, 80)}`);
  }

  const pool = {
    async connect() {
      return { query: async (text, values) => route(text, values), release() {} };
    },
  };

  return {
    pool,
    clock,
    advance(ms) { clock.ms += ms; },
    rows: () => state.rows,
    row: (id) => state.rows.find((r) => r.id === id),
    audit: () => state.audit,
  };
}
