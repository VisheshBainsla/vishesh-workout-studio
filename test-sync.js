/* Logic tests for sync.js using an in-memory phone and an in-memory cloud.
 * Run:  node test-sync.js
 * These prove the merge / queue / migration LOGIC. They do not talk to real Firebase. */
const assert = require('assert');
const Sync = require('./sync.js');
let passed = 0;
const t = async (name, fn) => { try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n', e); process.exitCode = 1; } };

/* ---- fake cloud (one shared "server", per-uid data) ---- */
function makeServer() {
  const users = new Map(); let clock = 1000;
  return {
    users, failNext: null, offline: false, dropWrites: false,
    forUid(uid) {
      const S = this;
      if (!users.has(uid)) users.set(uid, new Map());
      const docs = users.get(uid);
      const guard = () => { if (S.offline) { const e = new Error('offline'); e.code = 'unavailable'; throw e; } if (S.failNext) { const e = S.failNext; S.failNext = null; throw e; } };
      return {
        async fetchChanges(since) { guard(); return { docs: [...docs.entries()].filter(([, d]) => d.syncedAt > since).sort((a, b) => a[1].syncedAt - b[1].syncedAt).map(([id, d]) => Object.assign({ id }, JSON.parse(JSON.stringify(d)))) }; },
        // Same rule as cloud.js (a transaction) and firestore.rules: a write is accepted only if it is strictly newer
        // than the stored copy; an identical copy is a no-op; anything else is reported back as stale.
        async pushBatch(list) {
          guard(); if (S.beforeCommit) { const f = S.beforeCommit; S.beforeCommit = null; f(docs); }
          const ts = ++clock * 1000, stale = [];
          list.forEach(d => {
            const c = docs.get(d.id);
            if (c && c.updatedAt >= d.updatedAt) { if (!(c.updatedAt === d.updatedAt && !!c.deleted === !!d.deleted && (d.deleted || Sync.same(c.data, d.data)))) stale.push(d.id); return; }
            if (!S.dropWrites) docs.set(d.id, { store: d.store, key: d.key, deleted: !!d.deleted, data: d.deleted ? null : JSON.parse(JSON.stringify(d.data)), updatedAt: d.updatedAt, syncedAt: ts });
          });
          return { stale };
        },
        async getDocs(ids) { guard(); const m = new Map(); ids.forEach(id => { if (docs.has(id)) m.set(id, Object.assign({ id }, JSON.parse(JSON.stringify(docs.get(id))))); }); return m; }
      };
    }
  };
}

/* ---- fake phone: records + sync entries, mirrors what app.js does in one transaction ---- */
function makePhone(server, nowFn) {
  const st = { workouts: new Map(), sessions: new Map(), rest: new Map(), weights: new Map() };
  const meta = new Map(), kv = new Map();
  const keyOf = (s, r) => (s === 'rest' || s === 'weights') ? r.date : r.id;
  const host = {
    keyOf,
    async listRecords(s) { return [...st[s].values()].map(r => JSON.parse(JSON.stringify(r))); },
    async getRecord(s, k) { const r = st[s].get(k); return r ? JSON.parse(JSON.stringify(r)) : null; },
    async applyRemote(items) { items.forEach(i => { const k = Sync.metaKey(i.store, i.key); if (i.deleted) st[i.store].delete(i.key); else st[i.store].set(i.key, JSON.parse(JSON.stringify(i.data))); meta.set(k, { k, store: i.store, key: i.key, updatedAt: i.updatedAt, deleted: !!i.deleted, dirty: false }); }); },
    async clearStore(s) { st[s].clear(); },
    meta: {
      async all() { return [...meta.values()].map(m => Object.assign({}, m)); },
      async putMany(ms) { ms.forEach(m => meta.set(m.k, Object.assign({}, m))); },
      async put(m) { meta.set(m.k, Object.assign({}, m)); },
      async del(k) { meta.delete(k); },
      async clear() { meta.clear(); }
    },
    kv: { async get(n) { return kv.has(n) ? kv.get(n) : null; }, async set(n, v) { kv.set(n, v); } }
  };
  let t = 5000;
  const stamp = nowFn || (() => ++t);
  const phone = {
    st, meta, kv, host,
    put(s, rec, tracked = true) { st[s].set(keyOf(s, rec), JSON.parse(JSON.stringify(rec))); if (tracked) { const key = keyOf(s, rec), k = Sync.metaKey(s, key), prev = meta.get(k); meta.set(k, { k, store: s, key, updatedAt: Sync.nextStamp(prev && prev.updatedAt, stamp()), deleted: false, dirty: true }); } },
    del(s, key) { st[s].delete(key); const k = Sync.metaKey(s, key), prev = meta.get(k); meta.set(k, { k, store: s, key, updatedAt: Sync.nextStamp(prev && prev.updatedAt, stamp()), deleted: true, dirty: true }); },
    engine(uid, online = () => !server.offline) {
      const e = Sync.createEngine(host, { isOnline: online, now: () => 777, debounceMs: 0, setTimeout: () => 0, clearTimeout: () => {} });
      e.attach(server.forUid(uid), uid); e.enable(); return e;
    }
  };
  return phone;
}
const session = (id, title, date, sec) => ({ id, workoutId: 'w1', title, category: 'Full Body', date, startedAt: Date.parse(date) + 1000, endedAt: Date.parse(date) + 1000 + sec * 1000, activeSeconds: sec, completed: true });

(async () => {
  await t('doc ids round-trip and never contain "/"', () => {
    const id = Sync.docId('sessions', 'a/b__c d');
    assert(!id.includes('/')); assert.deepStrictEqual(Sync.parseDocId(id), { store: 'sessions', key: 'a/b__c d' });
    assert.strictEqual(Sync.docId('rest', '2026-11-07'), 'rest__2026-11-07');
  });

  await t('online save: workout, rest day and weight reach the cloud with all fields', async () => {
    const srv = makeServer(), p = makePhone(srv), e = p.engine('u1');
    p.put('sessions', session('s1', 'Morning HIIT', '2026-11-05', 1800));
    p.put('rest', { date: '2026-11-06', markedAt: 99 });
    p.put('weights', { date: '2026-11-05', kg: 71.4 });
    p.put('workouts', { id: 'w1', title: 'Morning HIIT', url: 'https://youtu.be/x', category: 'Full Body', durationMin: 30, videoId: null, createdAt: 1, lastUsedAt: 0 });
    const r = await e.syncNow();
    assert.strictEqual(r.pushed, 4); assert.strictEqual(e.status, 'synced');
    const docs = srv.users.get('u1');
    assert.strictEqual(docs.size, 4);
    const s = docs.get('sessions__s1');
    assert.strictEqual(s.data.title, 'Morning HIIT'); assert.strictEqual(s.data.date, '2026-11-05'); assert.strictEqual(s.data.activeSeconds, 1800); assert.strictEqual(s.data.endedAt, Date.parse('2026-11-05') + 1000 + 1800000);
    assert.strictEqual(docs.get('weights__2026-11-05').data.kg, 71.4);
    assert([...p.meta.values()].every(m => !m.dirty));
  });

  await t('offline: changes queue locally, sync automatically when back online, no duplicates', async () => {
    const srv = makeServer(), p = makePhone(srv), e = p.engine('u1');
    srv.offline = true;
    p.put('sessions', session('s1', 'Offline run', '2026-11-05', 600));
    const r1 = await e.syncNow();
    assert(r1.offline); assert.strictEqual(e.status, 'offline');
    assert.strictEqual((srv.users.get('u1') || new Map()).size, 0);
    assert.strictEqual([...p.meta.values()].filter(m => m.dirty).length, 1);
    p.put('sessions', session('s2', 'Offline walk', '2026-11-05', 300));
    srv.offline = false;
    await e.syncNow(); await e.syncNow(); await e.syncNow();
    assert.strictEqual(srv.users.get('u1').size, 2); assert.strictEqual(e.status, 'synced');
    assert.strictEqual(p.st.sessions.size, 2);
  });

  await t('network failure mid-upload leaves the entry queued and reports offline, then recovers', async () => {
    const srv = makeServer(), p = makePhone(srv), e = p.engine('u1');
    p.put('weights', { date: '2026-11-01', kg: 70 });
    srv.failNext = Object.assign(new Error('x'), { code: 'unavailable' });
    await e.syncNow();
    assert.strictEqual(e.status, 'offline'); assert([...p.meta.values()][0].dirty);
    await e.syncNow(); assert.strictEqual(e.status, 'synced'); assert.strictEqual(srv.users.get('u1').size, 1);
  });

  await t('permission-denied is reported as an error, not as offline', async () => {
    const srv = makeServer(), p = makePhone(srv), e = p.engine('u1');
    p.put('weights', { date: '2026-11-01', kg: 70 });
    srv.failNext = Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
    await e.syncNow(); assert.strictEqual(e.status, 'error'); assert(/rules/i.test(e.detail));
  });

  await t('another phone signs in and gets history, workout names, streak days, rest days and weights', async () => {
    const srv = makeServer(), a = makePhone(srv), ea = a.engine('u1');
    ['03', '04', '05'].forEach((d, i) => a.put('sessions', session('s' + i, 'Day ' + d, '2026-11-' + d, 1200 + i)));
    a.put('rest', { date: '2026-11-02', markedAt: 1 }); a.put('weights', { date: '2026-11-05', kg: 70.2 });
    await ea.syncNow();
    const b = makePhone(srv), eb = b.engine('u1');
    const s = await eb.localSummary(); assert.strictEqual(s.total, 0);
    await eb.syncNow();
    assert.strictEqual(b.st.sessions.size, 3); assert.strictEqual(b.st.sessions.get('s1').title, 'Day 04'); assert.strictEqual(b.st.sessions.get('s2').activeSeconds, 1202);
    assert.strictEqual(b.st.rest.get('2026-11-02').markedAt, 1); assert.strictEqual(b.st.weights.get('2026-11-05').kg, 70.2);
    assert([...b.meta.values()].every(m => !m.dirty));
  });

  await t('logout then login on the same phone restores records (wipe + pull)', async () => {
    const srv = makeServer(), a = makePhone(srv), e = a.engine('u1');
    a.put('sessions', session('s1', 'A', '2026-11-05', 100)); a.put('weights', { date: '2026-11-05', kg: 69 });
    await e.syncNow();
    await e.wipeLocalSynced(); assert.strictEqual(a.st.sessions.size, 0);
    await e.syncNow();
    assert.strictEqual(a.st.sessions.get('s1').title, 'A'); assert.strictEqual(a.st.weights.size, 1);
    assert.strictEqual(srv.users.get('u1').size, 2);
  });

  await t('delete on one phone (tombstone) removes it on the other, and stays deleted', async () => {
    const srv = makeServer(), a = makePhone(srv), b = makePhone(srv), ea = a.engine('u1'), eb = b.engine('u1');
    a.put('sessions', session('s1', 'Oops', '2026-11-05', 100)); await ea.syncNow(); await eb.syncNow();
    assert.strictEqual(b.st.sessions.size, 1);
    a.del('sessions', 's1'); await ea.syncNow(); await eb.syncNow();
    assert.strictEqual(b.st.sessions.size, 0); assert.strictEqual(srv.users.get('u1').get('sessions__s1').deleted, true);
    await ea.syncNow(); assert.strictEqual(a.st.sessions.size, 0);
  });

  await t('conflict: newest edit wins; an older local edit does not overwrite a newer cloud edit', async () => {
    const srv = makeServer(); let clockA = 10000, clockB = 20000;
    const a = makePhone(srv, () => ++clockA), b = makePhone(srv, () => ++clockB), ea = a.engine('u1'), eb = b.engine('u1');
    a.put('weights', { date: '2026-11-05', kg: 70 }); await ea.syncNow(); await eb.syncNow();
    a.put('weights', { date: '2026-11-05', kg: 71 });      // older (clock 10002)
    b.put('weights', { date: '2026-11-05', kg: 72 });      // newer (clock 20001)
    await eb.syncNow(); await ea.syncNow(); await eb.syncNow();
    assert.strictEqual(a.st.weights.get('2026-11-05').kg, 72); assert.strictEqual(b.st.weights.get('2026-11-05').kg, 72);
    assert.strictEqual(srv.users.get('u1').get('weights__2026-11-05').data.kg, 72);
  });

  await t('migration: old local records upload once, verified, with no duplicates even when run twice', async () => {
    const srv = makeServer(), p = makePhone(srv);
    // records that existed before sync: no sync entries
    [['sessions', session('s1', 'Old 1', '2026-10-01', 1000)], ['sessions', session('s2', 'Old 2', '2026-10-02', 1100)], ['rest', { date: '2026-10-03', markedAt: 5 }], ['weights', { date: '2026-10-01', kg: 75 }], ['workouts', { id: 'w1', title: 'Legs', url: '', videoId: null, category: 'Strength', durationMin: 20, createdAt: 3 }]].forEach(([s, r]) => p.put(s, r, false));
    const e = p.engine('u1');
    const sum = await e.localSummary(); assert.strictEqual(sum.total, 5); assert.strictEqual(sum.metas, 0);
    const r = await e.migrate(); assert(r.ok, JSON.stringify(r)); assert.strictEqual(r.pushed, 5); assert.strictEqual(r.verified, 5);
    assert.strictEqual(srv.users.get('u1').size, 5); assert.notStrictEqual(p.kv.get('migrated:u1'), undefined);
    const r2 = await e.migrate(); assert(r2.ok); assert.strictEqual(r2.pushed, 0);
    assert.strictEqual(srv.users.get('u1').size, 5); assert.strictEqual(p.st.sessions.size, 2);
  });

  await t('migration into an account that already has data merges; cloud-only records are kept; same ids do not duplicate', async () => {
    const srv = makeServer(), a = makePhone(srv), ea = a.engine('u1');
    a.put('sessions', session('s1', 'Shared', '2026-10-01', 1000)); a.put('sessions', session('cloudOnly', 'Cloud only', '2026-10-09', 500)); await ea.syncNow();
    const b = makePhone(srv);
    b.put('sessions', session('s1', 'Shared', '2026-10-01', 1000), false); b.put('sessions', session('localOnly', 'Local only', '2026-10-05', 700), false);
    const eb = b.engine('u1'); const r = await eb.migrate(); assert(r.ok);
    assert.strictEqual(srv.users.get('u1').size, 3); assert.strictEqual(b.st.sessions.size, 3);
    await ea.syncNow(); assert.strictEqual(a.st.sessions.size, 3);
  });

  await t('migration never replaces cloud with empty local; an empty phone deletes nothing in the cloud', async () => {
    const srv = makeServer(), a = makePhone(srv), ea = a.engine('u1');
    a.put('sessions', session('s1', 'Keep me', '2026-10-01', 1000)); a.put('weights', { date: '2026-10-01', kg: 80 }); await ea.syncNow();
    const empty = makePhone(srv), ee = empty.engine('u1');
    const r = await ee.migrate(); assert(r.ok); assert.strictEqual(r.pushed, 0);
    await ee.syncNow(); await ee.syncNow();
    assert.strictEqual(srv.users.get('u1').size, 2); assert([...srv.users.get('u1').values()].every(d => !d.deleted));
    assert.strictEqual(empty.st.sessions.size, 1);
  });

  await t('migration is NOT marked complete when the read-back shows missing data', async () => {
    const srv = makeServer(), p = makePhone(srv); p.put('sessions', session('s1', 'X', '2026-10-01', 10), false);
    srv.dropWrites = true;                                   // server silently loses the write
    const e = p.engine('u1'); const r = await e.migrate();
    assert.strictEqual(r.ok, false); assert.strictEqual(r.reason, 'verify'); assert.strictEqual(r.missing, 1);
    assert.strictEqual(p.kv.get('migrated:u1'), undefined); assert.strictEqual(p.st.sessions.size, 1);   // local data untouched
  });

  await t('migration while offline does nothing and loses nothing', async () => {
    const srv = makeServer(), p = makePhone(srv); p.put('sessions', session('s1', 'X', '2026-10-01', 10), false); srv.offline = true;
    const e = p.engine('u1'); const r = await e.migrate(); assert.strictEqual(r.ok, false); assert.strictEqual(r.reason, 'offline'); assert.strictEqual(p.st.sessions.size, 1);
  });

  await t('privacy: two accounts are separate (cloud adapters are bound to one uid)', async () => {
    const srv = makeServer(), a = makePhone(srv), ea = a.engine('alice');
    a.put('sessions', session('s1', 'Alice private', '2026-10-01', 10)); await ea.syncNow();
    const b = makePhone(srv), eb = b.engine('bob'); await eb.syncNow();
    assert.strictEqual(b.st.sessions.size, 0); assert.strictEqual(srv.users.get('bob').size, 0);
  });

  await t('switching account on a phone: rebase copies kept data to the new account; wipe removes only after being told', async () => {
    const srv = makeServer(), a = makePhone(srv), ea = a.engine('alice');
    a.put('sessions', session('s1', 'Alice', '2026-10-01', 10)); await ea.syncNow();
    ea.detach();
    const eb = Object.assign(a.engine('bob')); await eb.rebaseForNewOwner();
    assert([...a.meta.values()].every(m => m.dirty));
    const r = await eb.migrate(); assert(r.ok); assert.strictEqual(srv.users.get('bob').size, 1);
    assert.strictEqual(srv.users.get('alice').size, 1);
  });

  await t('an interrupted pull overlap re-reads docs harmlessly (idempotent)', async () => {
    const srv = makeServer(), a = makePhone(srv), ea = a.engine('u1'); a.put('sessions', session('s1', 'A', '2026-10-01', 10)); await ea.syncNow();
    for (let i = 0; i < 3; i++) await ea.syncNow();
    assert.strictEqual(a.st.sessions.size, 1); assert.strictEqual(srv.users.get('u1').size, 1);
  });

  await t('stale local legacy record never beats a newer cloud edit', async () => {
    const srv = makeServer(), a = makePhone(srv), ea = a.engine('u1'); a.put('weights', { date: '2026-10-01', kg: 70 }); await ea.syncNow();
    const old = makePhone(srv); old.put('weights', { date: '2026-10-01', kg: 99 }, false);
    const eo = old.engine('u1'); const r = await eo.migrate(); assert(r.ok);
    assert.strictEqual(old.st.weights.get('2026-10-01').kg, 70);        // legacy copy (no timestamp) loses to the dated cloud record
  });


  /* ===================== audit fixes ===================== */
  const W = (kg) => ({ date: '2026-11-05', kg });
  const wk = 'weights__2026-11-05';
  const cloudKg = (srv, uid) => srv.users.get(uid).get(wk).data && srv.users.get(uid).get(wk).data.kg;

  await t('nextStamp: always strictly newer than what it replaces, even with a slow clock', () => {
    assert.strictEqual(Sync.nextStamp(0, 100), 100); assert.strictEqual(Sync.nextStamp(500, 100), 501); assert.strictEqual(Sync.nextStamp(100, 100), 101); assert.strictEqual(Sync.nextStamp(undefined, 7), 7);
  });

  await t('SAME timestamp, DIFFERENT content: never marked synced; both phones and the cloud converge on one deterministic winner (either upload order)', async () => {
    for (const order of ['AB', 'BA']) {
      const srv = makeServer(), a = makePhone(srv, () => 50000), b = makePhone(srv, () => 50000), ea = a.engine('u'), eb = b.engine('u');
      a.put('weights', W(70)); b.put('weights', W(71));
      assert.strictEqual([...a.meta.values()][0].updatedAt, [...b.meta.values()][0].updatedAt);          // identical stamps
      const [f, g] = order === 'AB' ? [ea, eb] : [eb, ea];
      await f.syncNow(); await g.syncNow(); await ea.syncNow(); await eb.syncNow(); await ea.syncNow();
      const winner = a.st.weights.get('2026-11-05').kg;
      assert.strictEqual(winner, 71, 'larger canonical text wins');                                           // same rule on every device
      assert.strictEqual(b.st.weights.get('2026-11-05').kg, winner); assert.strictEqual(cloudKg(srv, 'u'), winner);
      assert([...a.meta.values(), ...b.meta.values()].every(m => !m.dirty));
    }
  });

  await t('same timestamp, different content: the losing phone is NOT silently marked synchronized (it must adopt the winner)', async () => {
    const srv = makeServer(), a = makePhone(srv, () => 50000), b = makePhone(srv, () => 50000), ea = a.engine('u'), eb = b.engine('u');
    a.put('weights', W(72)); await ea.syncNow();                      // cloud has 72 @50000
    b.put('weights', W(71));                                          // phone b: 71 @50000 (different, equal stamp)
    const r = await eb.pull();
    assert.strictEqual(r.conflicts, 1);
    assert.strictEqual(b.st.weights.get('2026-11-05').kg, 72);        // 72 > 71 canonically: remote wins, applied
    // and the other direction: local wins -> it is re-stamped newer and uploaded, not dropped
    const srv2 = makeServer(), c = makePhone(srv2, () => 50000), d = makePhone(srv2, () => 50000), ec = c.engine('u'), ed = d.engine('u');
    c.put('weights', W(71)); await ec.syncNow();
    d.put('weights', W(72)); const m0 = [...d.meta.values()][0].updatedAt;
    await ed.syncNow(); assert.strictEqual(d.st.weights.get('2026-11-05').kg, 72);
    assert([...d.meta.values()][0].updatedAt > m0, 'winner was re-stamped strictly newer'); assert.strictEqual(cloudKg(srv2, 'u'), 72);
    await ec.syncNow(); assert.strictEqual(c.st.weights.get('2026-11-05').kg, 72);
  });

  await t('same timestamp, identical content is simply recognised as already synchronized', async () => {
    const srv = makeServer(), a = makePhone(srv, () => 50000), b = makePhone(srv, () => 50000), ea = a.engine('u'), eb = b.engine('u');
    a.put('weights', W(70)); await ea.syncNow(); b.put('weights', W(70));
    const r = await eb.pull(); assert.strictEqual(r.conflicts, 0); assert([...b.meta.values()].every(m => !m.dirty));
  });

  await t('same timestamp: a delete beats an edit on every device', async () => {
    const srv = makeServer(), a = makePhone(srv, () => 60000), b = makePhone(srv, () => 60000), ea = a.engine('u'), eb = b.engine('u');
    a.put('weights', W(70)); await ea.syncNow(); await eb.syncNow();
    a.del('weights', '2026-11-05'); b.put('weights', W(75));
    assert.strictEqual([...a.meta.values()][0].updatedAt, [...b.meta.values()][0].updatedAt);
    await ea.syncNow(); await eb.syncNow(); await ea.syncNow();
    assert.strictEqual(a.st.weights.size, 0); assert.strictEqual(b.st.weights.size, 0); assert.strictEqual(srv.users.get('u').get(wk).deleted, true);
  });

  await t('clock skew: phone with a SLOW clock editing a record it already pulled still wins (stamp = previous + 1)', async () => {
    const srv = makeServer(); let ta = 1_000_000_000_000;                       // A: correct clock
    const a = makePhone(srv, () => (ta += 10)), b = makePhone(srv, () => 1_000_000_000_000 - 3_600_000);  // B: one hour BEHIND
    const ea = a.engine('u'), eb = b.engine('u');
    a.put('weights', W(70)); await ea.syncNow(); await eb.syncNow();
    b.put('weights', W(68));                                                      // genuinely later edit, but B's clock is behind
    assert([...b.meta.values()][0].updatedAt > [...a.meta.values()][0].updatedAt);
    await eb.syncNow(); await ea.syncNow();
    assert.strictEqual(a.st.weights.get('2026-11-05').kg, 68); assert.strictEqual(cloudKg(srv, 'u'), 68);
  });

  await t('clock skew: phone with a FAST clock does not freeze everyone else out (later edits still win)', async () => {
    const srv = makeServer();
    const a = makePhone(srv, () => 1_000_000_000_000 + 86_400_000 * 30), b = makePhone(srv, () => 1_000_000_000_000);   // A is 30 days AHEAD
    const ea = a.engine('u'), eb = b.engine('u');
    a.put('weights', W(70)); await ea.syncNow(); await eb.syncNow();
    b.put('weights', W(69)); await eb.syncNow(); await ea.syncNow();
    assert.strictEqual(a.st.weights.get('2026-11-05').kg, 69); assert.strictEqual(cloudKg(srv, 'u'), 69);
    a.put('weights', W(68)); await ea.syncNow(); await eb.syncNow(); assert.strictEqual(b.st.weights.get('2026-11-05').kg, 68);
  });

  await t('clock skew on a brand-new conflicting record (neither phone had seen the other): converges, never diverges', async () => {
    for (const aClock of [1_000_000_000_000 - 7_200_000, 1_000_000_000_000 + 7_200_000]) {
      const srv = makeServer(), a = makePhone(srv, () => aClock), b = makePhone(srv, () => 1_000_000_000_000), ea = a.engine('u'), eb = b.engine('u');
      a.put('weights', W(70)); b.put('weights', W(71));
      await ea.syncNow(); await eb.syncNow(); await ea.syncNow(); await eb.syncNow();
      assert.strictEqual(a.st.weights.get('2026-11-05').kg, b.st.weights.get('2026-11-05').kg); assert.strictEqual(cloudKg(srv, 'u'), a.st.weights.get('2026-11-05').kg);
    }
  });

  await t('two phones edit the same record while both are offline: after reconnecting (either order) all three agree on the later edit', async () => {
    for (const order of ['AB', 'BA']) {
      const srv = makeServer(); let c = 1_000_000;
      const a = makePhone(srv, () => ++c * 1000), b = makePhone(srv, () => ++c * 1000), ea = a.engine('u'), eb = b.engine('u');
      a.put('weights', W(70)); await ea.syncNow(); await eb.syncNow();
      srv.offline = true; a.put('weights', W(60)); b.put('weights', W(61)); srv.offline = false;       // b edited later
      const [f, g] = order === 'AB' ? [ea, eb] : [eb, ea];
      await f.syncNow(); await g.syncNow(); await ea.syncNow(); await eb.syncNow();
      assert.strictEqual(a.st.weights.get('2026-11-05').kg, 61); assert.strictEqual(b.st.weights.get('2026-11-05').kg, 61); assert.strictEqual(cloudKg(srv, 'u'), 61);
    }
  });

  await t('concurrent edits of DIFFERENT records on two phones are all kept (no lost workouts)', async () => {
    const srv = makeServer(), a = makePhone(srv), b = makePhone(srv), ea = a.engine('u'), eb = b.engine('u');
    srv.offline = true; a.put('sessions', session('sa', 'From A', '2026-11-05', 100)); b.put('sessions', session('sb', 'From B', '2026-11-05', 200)); srv.offline = false;
    await Promise.all([ea.syncNow(), eb.syncNow()]); await ea.syncNow(); await eb.syncNow();
    assert.strictEqual(a.st.sessions.size, 2); assert.strictEqual(b.st.sessions.size, 2); assert.strictEqual(srv.users.get('u').size, 2);
  });

  await t('simultaneous edit and delete: the LATER action wins on every device (delete later -> gone; edit later -> restored)', async () => {
    for (const deleteLater of [true, false]) {
      const srv = makeServer(); let c = 2_000_000;
      const a = makePhone(srv, () => ++c * 1000), b = makePhone(srv, () => ++c * 1000), ea = a.engine('u'), eb = b.engine('u');
      a.put('weights', W(70)); await ea.syncNow(); await eb.syncNow();
      srv.offline = true;
      if (deleteLater) { a.put('weights', W(66)); b.del('weights', '2026-11-05'); } else { b.del('weights', '2026-11-05'); a.put('weights', W(66)); }
      srv.offline = false;
      await ea.syncNow(); await eb.syncNow(); await ea.syncNow(); await eb.syncNow();
      if (deleteLater) { assert.strictEqual(a.st.weights.size, 0); assert.strictEqual(b.st.weights.size, 0); assert.strictEqual(srv.users.get('u').get(wk).deleted, true); }
      else { assert.strictEqual(a.st.weights.get('2026-11-05').kg, 66); assert.strictEqual(b.st.weights.get('2026-11-05').kg, 66); assert.strictEqual(srv.users.get('u').get(wk).deleted, false); }
    }
  });

  await t('STALE phone reconnects after a newer cloud update: its old edit is refused, the cloud keeps the newer record, then the phone adopts it', async () => {
    const srv = makeServer(); let c = 3_000_000;
    const a = makePhone(srv, () => ++c * 1000), b = makePhone(srv, () => ++c * 1000), ea = a.engine('u'), eb = b.engine('u');
    a.put('weights', W(70)); await ea.syncNow(); await eb.syncNow();
    b.put('weights', W(65));                       // b edits (older), stays unsynced
    a.put('weights', W(64)); await ea.syncNow();   // a edits later and uploads
    assert.strictEqual(cloudKg(srv, 'u'), 64);
    const pushed = await eb.push();                // stale phone pushes WITHOUT pulling first (worst case)
    assert.strictEqual(pushed.stale, 1, 'cloud refused the stale write'); assert.strictEqual(pushed.length, 0);
    assert.strictEqual(cloudKg(srv, 'u'), 64, 'cloud still holds the newer record');
    assert([...b.meta.values()][0].dirty, 'stale edit is not marked synchronized');
    await eb.syncNow();                            // normal cycle merges
    assert.strictEqual(b.st.weights.get('2026-11-05').kg, 64); assert([...b.meta.values()].every(m => !m.dirty)); assert.strictEqual(cloudKg(srv, 'u'), 64);
  });

  await t('race inside the upload: another phone writes between our read and our write -> our write is refused, nothing is overwritten', async () => {
    const srv = makeServer(); let c = 4_000_000;
    const a = makePhone(srv, () => ++c * 1000), b = makePhone(srv, () => ++c * 1000), ea = a.engine('u'), eb = b.engine('u');
    a.put('weights', W(70)); await ea.syncNow(); await eb.syncNow();
    b.put('weights', W(61));
    srv.beforeCommit = docs => { docs.set(wk, { store: 'weights', key: '2026-11-05', deleted: false, data: W(99), updatedAt: Date.now() + 1e9, syncedAt: 9e12 }); };   // a newer record lands first
    const r = await eb.syncNow();
    assert.strictEqual(cloudKg(srv, 'u'), 99, 'newer cloud record was not overwritten');
    await eb.syncNow(); assert.strictEqual(b.st.weights.get('2026-11-05').kg, 99); assert([...b.meta.values()].every(m => !m.dirty));
  });

  await t('a retried upload whose first attempt actually succeeded does not conflict with itself', async () => {
    const srv = makeServer(), a = makePhone(srv), ea = a.engine('u'); a.put('weights', W(70)); await ea.syncNow();
    const m = [...a.meta.values()][0]; a.meta.set(m.k, Object.assign({}, m, { dirty: true }));   // pretend the acknowledgement was lost
    const pushed = await ea.push(); assert.strictEqual(pushed.stale, 0); assert([...a.meta.values()].every(m => !m.dirty)); assert.strictEqual(cloudKg(srv, 'u'), 70);
  });

  console.log('\n' + passed + ' sync tests passed' + (process.exitCode ? ' — WITH FAILURES' : ''));
})();
