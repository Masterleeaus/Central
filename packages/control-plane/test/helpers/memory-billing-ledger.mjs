// TEST ONLY. In-memory billing ledger with the same contract as billing-ledger-pg.ts.
export function memoryLedger() {
  const events = new Map();
  const subs = new Map();
  const chains = new Map();
  const tx = {
    async beginEvent(e) {
      const k = `${e.provider}|${e.providerEventId}`;
      if (events.has(k)) return { kind: 'existing', disposition: events.get(k).disposition };
      events.set(k, { ...e, disposition: 'pending', reason: '', requestIds: [] });
      return { kind: 'new' };
    },
    async subscription(p, s) { const r = subs.get(`${p}|${s}`); return r ? { ...r } : undefined; },
    async advance(p, s, rec) {
      const k = `${p}|${s}`;
      const cur = subs.get(k);
      if (cur && (Date.parse(rec.positionAt) < Date.parse(cur.positionAt) || (rec.positionAt === cur.positionAt && rec.positionEventId < cur.positionEventId))) throw Error('subscription position regressed');
      subs.set(k, { ...rec });
    },
    async finish(p, id, disposition, detail) {
      const e = events.get(`${p}|${id}`);
      if (!e) throw Error('missing event');
      Object.assign(e, { disposition, reason: detail.reason, requestIds: [...detail.requestIds] });
    },
  };
  return {
    events, subs,
    eventsList: () => [...events.values()],
    async withSubscriptionLock(provider, sub, task) {
      const key = `${provider}|${sub}`;
      const prev = chains.get(key) ?? Promise.resolve();
      const run = prev.then(() => task(tx));
      chains.set(key, run.catch(() => {}));
      return run;
    },
  };
}
