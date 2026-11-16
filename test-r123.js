/* R1/R2/R3 logic tests (validator, quarantine, bisecting push). Based on the helpers of test-sync.js.
 * Run: node test-r123.js
 * Logic tests for sync.js using an in-memory phone and an in-memory cloud.
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
          guard(); S.pushCalls = (S.pushCalls || 0) + 1; if (S.refuse && list.some(S.refuse)) { throw Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' }); } if (S.beforeCommit) { const f = S.beforeCommit; S.beforeCommit = null; f(docs); }
          const ts = ++clock * 1000, stale = [];
          list.forEach(d => {
            const c = docs.get(d.id);
            if (c && c.updatedAt >= d.updatedAt) { if (!(c.updatedAt === d.updatedAt && !!c.deleted === !!d.deleted && (d.deleted || Sync.same(c.data, d.data)))) stale.push(d.id); return; }
            if (!S.dropWrites) docs.set(d.id, { store: d.store, key: d.key, deleted: !!d.deleted, data: d.deleted ? null : JSON.parse(JSON.stringify(d.data)), updatedAt: d.updatedAt, syncedAt: ts });
          });
          return { stale };
        },
        async probe() { guard(); S.probeCalls = (S.probeCalls || 0) + 1; if (S.probeDenied) throw Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' }); },
        inject(id, d) { docs.set(id, Object.assign({ syncedAt: ++clock * 1000 }, d)); },
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
    kv: { async get(n) { return kv.has(n) ? kv.get(n) : null; }, async set(n, v) { kv.set(n, JSON.parse(JSON.stringify(v))); }, async del(n) { kv.delete(n); }, async list(p) { return [...kv.entries()].filter(([k]) => k.indexOf(p) === 0).map(([k, v]) => ({ k, v: JSON.parse(JSON.stringify(v)) })); } }
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


const Core = require('./core.js');
const W = (id, o) => Object.assign({ id, title: 'W ' + id, url: 'https://youtu.be/abc', videoId: null, category: 'Other', durationMin: 10, createdAt: 1, lastUsedAt: 0 }, o || {});
const ids = a => a.map(x => x.id);

(async () => {
  /* ---------- R3: is Core.sanitizeImport suitable for single records? ---------- */
  await t('R3 evidence: sanitizeImport REPAIRS/rejects real records, so it is not used for sync validation', () => {
    const orig = { app: 'vishesh-workout-studio', version: 2,
      workouts: [W('v1', { url: '', videoId: 'vid1' }), W('v2', { url: 'https://example.com/not-youtube' })],
      weights: [{ date: '2026-11-05', kg: 71.44 }],
      sessions: [{ id: 's1', workoutId: null, title: 'T', category: '', date: '2026-11-05', startedAt: 1, endedAt: 2, activeSeconds: 5, completed: false, extra: 'x' }] };
    const r = Core.sanitizeImport(JSON.parse(JSON.stringify(orig))).data;
    assert.strictEqual(r.weights[0].kg, 71.4);                  // silently rounded
    assert.strictEqual(r.sessions[0].completed, true);          // silently rewritten
    assert.strictEqual(r.sessions[0].extra, undefined);         // field dropped
    assert.strictEqual(r.workouts.length, 1);                   // v1 kept
    assert(!r.workouts.some(w => w.id === 'v2'));               // non-YouTube url rejected (a sync validator must not care)
    assert(Sync.validateRecord('workouts', orig.workouts[1]).ok); // our validator accepts it, unchanged
    assert(Sync.validateRecord('weights', orig.weights[0]).ok);
    assert(Sync.validateRecord('sessions', orig.sessions[0]).ok);
    assert.strictEqual(orig.weights[0].kg, 71.44);              // and never mutates
  });

  await t('R3 validator: rejects wrong types, ranges, fake dates, unknown store, key mismatch, nested arrays, NaN, too many fields', () => {
    const bad = (s, r, k) => assert.strictEqual(Sync.validateRecord(s, r, k).ok, false, JSON.stringify(r));
    bad('weights', { date: '2026-02-30', kg: 70 }); bad('weights', { date: '2026-11-05', kg: 5 }); bad('weights', { date: '2026-11-05', kg: '70' });
    bad('weights', { date: '2026-11-05', kg: NaN }); bad('rest', { date: 'x' }); bad('rest', null); bad('rest', []);
    bad('sessions', { id: 's', date: '2026-11-05', activeSeconds: -1 }); bad('sessions', { id: 's', date: '2026-11-05', activeSeconds: 1e9 });
    bad('workouts', W('')); bad('workouts', W('a', { title: '' })); bad('workouts', W('a', { durationMin: 'ten' })); bad('workouts', W('a', { title: 'x'.repeat(121) }));
    bad('workouts', W('a', { tags: [[1]] })); bad('workouts', W('a', { f: undefined, g: () => 1 })); bad('nope', { id: 'a' });
    bad('workouts', W('a'), 'b');                                // key must equal the record's own id
    const many = W('a'); for (let i = 0; i < 40; i++) many['f' + i] = i; bad('workouts', many);
    assert(Sync.validateRecord('workouts', W('a'), 'a').ok); assert(Sync.validateRecord('rest', { date: '2026-11-05', markedAt: 3 }).ok);
    assert(Sync.validateRecord('weights', { date: '2024-02-29', kg: 70.5 }).ok);
  });

  /* ---------- R1: key / document-id limits ---------- */
  await t('R1 key limits: encoded key <= 600 ok, 601 refused; lone surrogate and empty refused; unicode counted AFTER encoding', () => {
    assert.strictEqual(Sync.checkKey('workouts', 'a'.repeat(600)), null);
    assert(Sync.checkKey('workouts', 'a'.repeat(601)));
    assert(Sync.checkKey('workouts', '\uD800'));          // encodeURIComponent would throw
    assert(Sync.checkKey('workouts', ''));
    assert(Sync.checkKey('workouts', 'é'.repeat(100)) === null);      // 100 * 6 = 600 encoded chars
    assert(Sync.checkKey('workouts', 'é'.repeat(101)));
    assert(Sync.checkKey('weird', 'a'));
    assert.strictEqual(Sync.KEY_MAX, 600);
    assert(Sync.docId('workouts', 'a'.repeat(600)).length <= 1500);
  });

  /* ---------- R1: outgoing ---------- */
  await t('R1 outgoing: one invalid local record does not block the valid ones; it is kept, counted, exported, and never deleted', async () => {
    const srv = makeServer(), p = makePhone(srv), e = p.engine('u1');
    p.put('workouts', W('w1')); p.put('workouts', W('w2')); p.put('weights', { date: '2026-11-05', kg: 70 });
    p.put('weights', { date: '2026-11-06', kg: 9999 });               // invalid
    p.put('workouts', W('x'.repeat(700)));                             // key too long
    const r = await e.syncNow();
    assert.strictEqual(r.pushed, 3); assert.strictEqual(e.status, 'synced');
    assert.strictEqual(srv.users.get('u1').size, 3);
    assert.strictEqual(e.skipped.total, 2); assert.strictEqual(e.skipped.out, 2); assert.strictEqual(e.getState().skipped.total, 2);
    assert(p.st.weights.has('2026-11-06')); assert(p.st.workouts.has('x'.repeat(700)));    // local data untouched
    assert([...p.meta.values()].filter(m => m.dirty).length === 2);                          // still queued, not dropped
    const x = await e.exportQuarantine(); assert.strictEqual(x.count, 2);
    assert(x.items.every(i => i.reason && i.payload)); assert.strictEqual(x.items.find(i => i.store === 'weights').payload.kg, 9999);
    // recovery: the person edits the bad weight; the next sync uploads it and the entry disappears
    p.put('weights', { date: '2026-11-06', kg: 70.5 });
    await e.syncNow();
    assert.strictEqual(srv.users.get('u1').size, 4); assert.strictEqual(e.skipped.total, 1);
    assert.strictEqual((await e.quarantineList()).length, 1);
  });

  await t('R1 outgoing: invalid records are never uploaded, and the rest of the batch still arrives after reconnect (offline then online)', async () => {
    const srv = makeServer(), p = makePhone(srv), e = p.engine('u1');
    srv.offline = true;
    p.put('workouts', W('ok1')); p.put('rest', { date: 'not-a-date' }); p.put('workouts', W('ok2'));
    const r1 = await e.syncNow(); assert(r1.offline);
    srv.offline = false; await e.syncNow();
    assert.deepStrictEqual([...srv.users.get('u1').keys()].sort(), ['workouts__ok1', 'workouts__ok2']);
    assert.strictEqual(e.skipped.total, 1);
  });

  await t('R1 cloud refuses ONE record (rules reject): batch is bisected, the others sync, the refused one is quarantined and not re-sent every cycle', async () => {
    const srv = makeServer(), p = makePhone(srv), e = p.engine('u1');
    srv.refuse = d => d.key === 'poison';
    ['a', 'b', 'c', 'poison', 'd', 'e'].forEach(k => p.put('workouts', W(k)));
    const r = await e.syncNow();
    assert.strictEqual(e.status, 'synced'); assert.strictEqual(r.pushed, 5);
    assert.deepStrictEqual([...srv.users.get('u1').keys()].sort(), ['workouts__a', 'workouts__b', 'workouts__c', 'workouts__d', 'workouts__e']);
    assert.strictEqual(e.skipped.total, 1); assert(p.st.workouts.has('poison'));
    const q = (await e.quarantineList())[0]; assert(q.cloudRefused); assert(/permission-denied/.test(q.reason));
    const calls = srv.pushCalls; await e.syncNow(); assert.strictEqual(srv.pushCalls, calls, 'no upload attempt when nothing changed and the refused version is unchanged');
    // Retry after the cause is fixed (rules relaxed): it uploads
    srv.refuse = null; await e.retryQuarantine();
    assert.strictEqual(srv.users.get('u1').size, 6); assert.strictEqual(e.skipped.total, 0);
  });

  await t('R1 systemic refusal (rules not published / sign-in problem): probe also fails -> NOTHING quarantined, clear error with instructions, data stays queued; recovers by itself once fixed', async () => {
    const srv = makeServer(), p = makePhone(srv), e = p.engine('u1');
    srv.refuse = () => true; srv.probeDenied = true;
    ['a', 'b', 'c'].forEach(k => p.put('workouts', W(k)));
    await e.syncNow();
    assert.strictEqual(e.status, 'error'); assert.strictEqual(e.skipped.total, 0);
    assert(/latest firestore\.rules is published/.test(e.detail) && /safe on this phone/.test(e.detail), 'error message tells what to do: ' + e.detail);
    assert.strictEqual([...p.meta.values()].filter(m => m.dirty).length, 3);
    srv.refuse = null; srv.probeDenied = false;                    // person publishes the rules, taps Sync now
    await e.syncNow(); assert.strictEqual(e.status, 'synced'); assert.strictEqual(srv.users.get('u1').size, 3);
    // single dirty record, first push, probe also denied: still a setup problem, not a poison record
    const p2 = makePhone(srv), e2 = p2.engine('u2'); srv.refuse = () => true; srv.probeDenied = true; p2.put('workouts', W('only'));
    await e2.syncNow(); assert.strictEqual(e2.skipped.total, 0); assert.strictEqual(e2.status, 'error');
  });

  await t('R1 LIMITATION FIXED: a lone dirty record refused on the very first push is skipped (probe proves the cloud works); sync is NOT stuck and later records upload', async () => {
    const srv = makeServer(), p = makePhone(srv), e = p.engine('u1');
    srv.refuse = d => d.key === 'poison';
    p.put('workouts', W('poison'));
    await e.syncNow();
    assert.strictEqual(e.status, 'synced', 'status must not stay "error"'); assert.strictEqual(e.skipped.total, 1); assert(srv.probeCalls >= 1);
    p.put('workouts', W('fine1')); p.put('weights', { date: '2026-11-05', kg: 70 });
    await e.syncNow();
    assert.strictEqual(e.status, 'synced'); assert.deepStrictEqual([...srv.users.get('u1').keys()].sort(), ['weights__2026-11-05', 'workouts__fine1']);
    assert(p.st.workouts.has('poison'));                                 // never deleted
    // two refused records alone in a batch (batch of 2, all refused, probe ok) -> both skipped, no stuck error
    const p2 = makePhone(srv), e2 = p2.engine('u3'); srv.refuse = d => /^bad/.test(d.key);
    p2.put('workouts', W('bad1')); p2.put('workouts', W('bad2')); await e2.syncNow();
    assert.strictEqual(e2.status, 'synced'); assert.strictEqual(e2.skipped.total, 2); assert.strictEqual(e2.skipped.refused, 2);
  });

  await t('R1 rules break MID-SESSION (earlier uploads worked): one lone valid record is NOT wrongly skipped; error + instructions; uploads once fixed', async () => {
    const srv = makeServer(), p = makePhone(srv), e = p.engine('u1');
    p.put('workouts', W('first')); await e.syncNow(); assert.strictEqual(e.status, 'synced');
    srv.refuse = () => true; srv.probeDenied = true; p.put('workouts', W('second'));
    await e.syncNow(); assert.strictEqual(e.status, 'error'); assert.strictEqual(e.skipped.total, 0);
    srv.refuse = null; srv.probeDenied = false; await e.syncNow();
    assert.strictEqual(e.status, 'synced'); assert.strictEqual(srv.users.get('u1').size, 2);
  });

  await t('R1 probe network failure while checking: treated as offline (retry later), nothing quarantined', async () => {
    const srv = makeServer(), p = makePhone(srv), e = p.engine('u1');
    srv.refuse = () => true; ['a', 'b'].forEach(k => p.put('workouts', W(k)));
    const cl = srv.forUid('u1'); const orig = srv.forUid; srv.forUid = uid => { const c = orig.call(srv, uid); c.probe = async () => { throw Object.assign(new Error('offline'), { code: 'unavailable' }); }; return c; };
    const e3 = p.engine('u1'); await e3.syncNow();
    assert(e3.status === 'offline' || e3.status === 'error'); assert.strictEqual(e3.skipped.total, 0);
  });

  await t('R1 tombstones: deleting a record with an overlong key cannot break the batch either', async () => {
    const srv = makeServer(), p = makePhone(srv), e = p.engine('u1');
    p.put('workouts', W('ok')); p.del('workouts', 'k'.repeat(900));
    await e.syncNow(); assert.strictEqual(srv.users.get('u1').size, 1); assert.strictEqual((await e.quarantineList()).length, 1);   // kept aside, not counted (the record itself was deleted by the person)
  });

  /* ---------- R3 / R1: incoming ---------- */
  await t('R3 incoming: bad cloud records are skipped individually and kept aside; good ones in the same download are saved', async () => {
    const srv = makeServer(), p = makePhone(srv), e = p.engine('u1'), cl = srv.forUid('u1');
    const doc = (store, key, data, extra) => Object.assign({ store, key, deleted: false, data, updatedAt: 100 }, extra || {});
    cl.inject('workouts__good1', doc('workouts', 'good1', W('good1')));
    cl.inject('weights__2026-11-05', doc('weights', '2026-11-05', { date: '2026-11-05', kg: 80 }));
    cl.inject('weights__2026-11-06', doc('weights', '2026-11-06', { date: '2026-11-06', kg: 'heavy' }));         // wrong type
    cl.inject('sessions__s1', doc('sessions', 's1', { id: 'OTHER', date: '2026-11-05', activeSeconds: 5 }));       // key mismatch
    cl.inject('tracks__t1', doc('tracks', 't1', { id: 't1' }));                                                   // store not synced
    cl.inject('rest__2026-11-07', doc('rest', '2026-11-07', { date: '2026-11-07', markedAt: 1 }));
    cl.inject('workouts__nulldata', doc('workouts', 'nulldata', null));                                          // null data but not deleted
    cl.inject('workouts__gone', doc('workouts', 'gone', null, { deleted: true }));                               // tombstone is fine
    const r = await e.syncNow();
    assert.strictEqual(e.status, 'synced');
    assert.deepStrictEqual([...p.st.workouts.keys()], ['good1']); assert(p.st.weights.has('2026-11-05')); assert(p.st.rest.has('2026-11-07'));
    assert(!p.st.weights.has('2026-11-06')); assert.strictEqual(p.st.sessions.size, 0);
    assert.strictEqual(e.skipped.in, 4); assert.strictEqual(e.skipped.total, 4);
    const q = await e.quarantineList(); assert.strictEqual(q.find(x => x.id === 'weights__2026-11-06').payload.data.kg, 'heavy');   // kept verbatim
    assert([...p.meta.values()].every(m => !m.dirty));
    assert.strictEqual(r.pulled.rejected, 4);
    // another phone fixes the bad record with a newer version: it is applied and the entry clears
    cl.inject('weights__2026-11-06', doc('weights', '2026-11-06', { date: '2026-11-06', kg: 81 }, { updatedAt: 200 }));
    await e.syncNow(); assert.strictEqual(p.st.weights.get('2026-11-06').kg, 81); assert.strictEqual(e.skipped.in, 3);
    const x = await e.exportQuarantine(); assert.strictEqual(x.count, 3);
  });

  await t('R3 incoming: a bad remote record can not overwrite a good local one', async () => {
    const srv = makeServer(), p = makePhone(srv), e = p.engine('u1'), cl = srv.forUid('u1');
    p.put('weights', { date: '2026-11-05', kg: 70 });
    await e.syncNow();
    cl.inject('weights__2026-11-05', { store: 'weights', key: '2026-11-05', deleted: false, data: { date: '2026-11-05', kg: -3 }, updatedAt: 99999999 });
    await e.syncNow();
    assert.strictEqual(p.st.weights.get('2026-11-05').kg, 70); assert.strictEqual(e.skipped.in, 1);
  });

  await t('R1 account isolation: skipped records belong to one account; another account on the same phone sees none', async () => {
    const srv = makeServer(), p = makePhone(srv), e1 = p.engine('u1');
    p.put('weights', { date: '2026-11-06', kg: 9999 }); await e1.syncNow(); assert.strictEqual(e1.skipped.total, 1);
    const e2 = p.engine('u2'); await e2.refreshQuarantine(); assert.strictEqual(e2.skipped.total, 0);
    assert.strictEqual((await e1.quarantineList()).length, 1);
    await e1.wipeLocalSynced();                        // explicit wipe of local synced stores must not erase the kept record copy
    assert.strictEqual((await e1.quarantineList()).length, 1);
    assert.strictEqual((await e1.refreshQuarantine()).total, 0);   // not counted: record no longer on the phone
  });

  await t('R1 migration with one invalid record still verifies the valid ones and reports the skipped count', async () => {
    const srv = makeServer(), p = makePhone(srv), e = p.engine('u1');
    p.put('workouts', W('m1'), false); p.put('weights', { date: '2026-11-06', kg: 1 }, false); p.put('weights', { date: '2026-11-07', kg: 80 }, false);
    const r = await e.migrate();
    assert.strictEqual(r.ok, true); assert.strictEqual(r.skipped, 1); assert.strictEqual(r.pushed, 2); assert(p.st.weights.has('2026-11-06'));
  });

  console.log('\n' + passed + ' R1/R2/R3 logic tests passed' + (process.exitCode ? ' (WITH FAILURES)' : ''));
})();
