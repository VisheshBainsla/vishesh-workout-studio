/* Emulator tests for the REAL ../firestore.rules (not mockfb.js).
 * Run:  cd emulator-tests && npm install && npm test      (needs Java 11+ and Node 18+)
 * Uses the demo project "demo-vws": nothing here can reach a real Firebase project or any billing. */
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc, deleteDoc, getDocs, collection, query, where, orderBy, serverTimestamp, runTransaction, Timestamp } = require('firebase/firestore');

let env;
before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-vws', firestore: { rules: fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8'), host: '127.0.0.1', port: 8080 } });
});
after(async () => { if (env) await env.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); });

const A = 'userA', B = 'userB';
const db = uid => env.authenticatedContext(uid).firestore();      // a signed-in phone
const anon = () => env.unauthenticatedContext().firestore();
const rid = (store, key) => store + '__' + encodeURIComponent(key);
const recRef = (d, uid, store, key) => doc(d, 'users', uid, 'records', rid(store, key));
// `key` in the cloud document is the URL-encoded record key, and the document id is <store>__<that key> (same as the app)
const rec = (store, key, updatedAt, o) => Object.assign({ store, key: encodeURIComponent(key), deleted: false, data: store === 'weights' ? { date: key, kg: 70 } : { id: key, title: 'Run' }, updatedAt, syncedAt: serverTimestamp(), device: 'd1', schema: 1 }, o || {});
const seed = async (uid, store, key, updatedAt, o) => env.withSecurityRulesDisabled(async c => { await setDoc(recRef(c.firestore(), uid, store, key), Object.assign(rec(store, key, updatedAt, o), { syncedAt: Timestamp.now() })); });

/* 1 ─ Authentication / ownership */
test('1a unauthenticated users cannot read or write anything', async () => {
  await assertFails(getDoc(doc(anon(), 'users', A)));
  await assertFails(setDoc(doc(anon(), 'users', A), { displayName: 'x', email: 'x@y.z' }));
  await assertFails(getDoc(recRef(anon(), A, 'weights', '2026-11-05')));
  await assertFails(setDoc(recRef(anon(), A, 'weights', '2026-11-05'), rec('weights', '2026-11-05', 1)));
  await assertFails(getDocs(collection(anon(), 'users', A, 'records')));
});
test('1b owner can read and write own profile and records', async () => {
  await assertSucceeds(setDoc(doc(db(A), 'users', A), { displayName: 'Vishesh', email: 'v@example.com', updatedAt: 1, schema: 1, goalMin: 30 }));
  await assertSucceeds(getDoc(doc(db(A), 'users', A)));
  await assertSucceeds(setDoc(recRef(db(A), A, 'weights', '2026-11-05'), rec('weights', '2026-11-05', 100)));
  await assertSucceeds(getDoc(recRef(db(A), A, 'weights', '2026-11-05')));
  await assertSucceeds(getDocs(query(collection(db(A), 'users', A, 'records'), where('syncedAt', '>', Timestamp.fromMillis(0)), orderBy('syncedAt'))));
});
test('1c user B cannot read or write user A profile or records', async () => {
  await seed(A, 'sessions', 's1', 100);
  await env.withSecurityRulesDisabled(async c => setDoc(doc(c.firestore(), 'users', A), { displayName: 'A', email: 'a@x.y', updatedAt: 1, schema: 1 }));
  await assertFails(getDoc(doc(db(B), 'users', A)));
  await assertFails(setDoc(doc(db(B), 'users', A), { displayName: 'hacked', email: 'b@x.y' }));
  await assertFails(getDoc(recRef(db(B), A, 'sessions', 's1')));
  await assertFails(getDocs(collection(db(B), 'users', A, 'records')));
  await assertFails(setDoc(recRef(db(B), A, 'sessions', 's1'), rec('sessions', 's1', 9999)));
  await assertFails(setDoc(recRef(db(B), A, 'sessions', 'new'), rec('sessions', 'new', 1)));
});
test('1d no other path is reachable, even for a signed-in user', async () => {
  await assertFails(setDoc(doc(db(A), 'public', 'x'), { a: 1 }));
  await assertFails(getDoc(doc(db(A), 'public', 'x')));
  await assertFails(setDoc(doc(db(A), 'users', A, 'other', 'x'), { a: 1 }));
  await assertFails(getDocs(collection(db(A), 'users')));
});

/* 2 ─ Validation */
test('2a invalid store names are rejected', async () => {
  await assertFails(setDoc(recRef(db(A), A, 'tracks', 't1'), rec('tracks', 't1', 1)));
  await assertFails(setDoc(recRef(db(A), A, 'videos', 'v1'), rec('videos', 'v1', 1)));
});
test('2b malformed document ids are rejected', async () => {
  const bad = ['x', 'sessions', 'sessions__', 'foo__bar', '__sessions', 'Sessions__s1'];
  for (const id of bad) await assertFails(setDoc(doc(db(A), 'users', A, 'records', id), rec('sessions', 's1', 1)), 'id ' + id);
  await assertFails(setDoc(doc(db(A), 'users', A, 'records', 'weights__2026-11-05'), rec('sessions', '2026-11-05', 1)));   // id says weights, data says sessions
});
test('2b-2 key must equal the document id; key characters are restricted', async () => {
  // key field says 2026-11-06 but the document id says 2026-11-05  -> refused
  await assertFails(setDoc(doc(db(A), 'users', A, 'records', 'weights__2026-11-05'), rec('weights', '2026-11-06', 1)));
  // key not URL-encoded (contains a space / slash / quote) -> refused, even when the id is built from it
  await assertFails(setDoc(doc(db(A), 'users', A, 'records', 'sessions__a b'), rec('sessions', 'a b', 1, { key: 'a b' })));
  await assertFails(setDoc(doc(db(A), 'users', A, 'records', 'sessions__a_b'), rec('sessions', 'a_b', 1, { key: 'a/b' })));
  await assertFails(setDoc(doc(db(A), 'users', A, 'records', 'sessions__a_b'), rec('sessions', 'a_b', 1, { key: "a'b\"" })));
  // empty key -> refused
  await assertFails(setDoc(doc(db(A), 'users', A, 'records', 'sessions__'), rec('sessions', 'x', 1, { key: '' })));
  // controls: ordinary ids and an encoded unusual id are accepted, and the id must match exactly
  await assertSucceeds(setDoc(recRef(db(A), A, 'sessions', 'lq3k9x1abc123'), rec('sessions', 'lq3k9x1abc123', 1)));
  await assertSucceeds(setDoc(recRef(db(A), A, 'sessions', 'my id/ü'), rec('sessions', 'my id/ü', 1)));
});
test('2e data size limit: at most 40 fields (or null for a tombstone)', async () => {
  const fields = n => Object.fromEntries(Array.from({ length: n }, (_, i) => ['f' + i, i]));
  await assertSucceeds(setDoc(recRef(db(A), A, 'sessions', 'big40'), rec('sessions', 'big40', 1, { data: fields(40) })));
  await assertFails(setDoc(recRef(db(A), A, 'sessions', 'big41'), rec('sessions', 'big41', 1, { data: fields(41) })));
  await assertFails(setDoc(recRef(db(A), A, 'sessions', 'big500'), rec('sessions', 'big500', 1, { data: fields(500) })));
  await assertSucceeds(setDoc(recRef(db(A), A, 'sessions', 'gone'), rec('sessions', 'gone', 1, { deleted: true, data: null })));
});
test('2c invalid data types are rejected', async () => {
  const r = (o) => setDoc(recRef(db(A), A, 'sessions', 's1'), rec('sessions', 's1', 1, o));
  await assertFails(r({ key: 123 }));
  await assertFails(r({ deleted: 'no' }));
  await assertFails(r({ data: ['a'] }));
  await assertFails(r({ data: 'text' }));
  await assertFails(r({ data: 5 }));
  await assertFails(r({ updatedAt: '100' }));
  await assertFails(r({ updatedAt: null }));
  await assertFails(r({ syncedAt: Timestamp.now() }));          // must be the server time
  await assertFails(r({ syncedAt: 5 }));
  await assertFails(setDoc(recRef(db(A), A, 'sessions', 's1'), Object.assign(rec('sessions', 's1', 1), { key: 's' + 'x'.repeat(250) })));
  await assertSucceeds(r({}));                                    // control: the valid shape is accepted
});
test('2f key length limit is 600 (URL-encoded): 600 accepted, 601 refused, matching sync.js KEY_MAX', async () => {
  const k600 = 'a'.repeat(600), k601 = 'a'.repeat(601);
  await assertSucceeds(setDoc(recRef(db(A), A, 'workouts', k600), rec('workouts', k600, 1)));
  await assertFails(setDoc(recRef(db(A), A, 'workouts', k601), rec('workouts', k601, 1)));
  const e100 = '\u00e9'.repeat(100);                                   // 100 x "%C3%A9" = 600 encoded characters
  await assertSucceeds(setDoc(recRef(db(A), A, 'workouts', e100), rec('workouts', e100, 1)));
  const e101 = '\u00e9'.repeat(101);
  await assertFails(setDoc(recRef(db(A), A, 'workouts', e101), rec('workouts', e101, 1)));
});
test('2d unauthorized / missing fields are rejected', async () => {
  await assertFails(setDoc(recRef(db(A), A, 'sessions', 's1'), rec('sessions', 's1', 1, { admin: true })));
  const noStore = rec('sessions', 's1', 1); delete noStore.store;
  await assertFails(setDoc(recRef(db(A), A, 'sessions', 's1'), noStore));
  await assertFails(setDoc(doc(db(A), 'users', A), { displayName: 'x', email: 'x@y.z', role: 'admin' }));
  await assertFails(setDoc(doc(db(A), 'users', A), { displayName: 5, email: 'x@y.z' }));
  await assertFails(setDoc(doc(db(A), 'users', A), { displayName: 'x'.repeat(121), email: 'x@y.z' }));
  await assertFails(setDoc(doc(db(A), 'users', A), { displayName: 'x', email: 'x@y.z', goalMin: 'thirty' }));
  await assertSucceeds(setDoc(doc(db(A), 'users', A), { displayName: 'x', email: 'x@y.z', goalMin: 30, updatedAt: 1, schema: 1 }));
});

/* 3 ─ Timestamp protection */
test('3 stale and equal-timestamp overwrites are rejected; newer ones accepted', async () => {
  const ref = () => recRef(db(A), A, 'weights', '2026-11-05');
  await assertSucceeds(setDoc(ref(), rec('weights', '2026-11-05', 100)));
  await assertFails(setDoc(ref(), rec('weights', '2026-11-05', 100, { data: { date: '2026-11-05', kg: 99 } })));   // equal timestamp
  await assertFails(setDoc(ref(), rec('weights', '2026-11-05', 99)));                                                // stale
  await assertFails(setDoc(ref(), rec('weights', '2026-11-05', 0)));
  await assertSucceeds(setDoc(ref(), rec('weights', '2026-11-05', 101, { data: { date: '2026-11-05', kg: 68 } })));
  const snap = await assertSucceeds(getDoc(ref())); assert.strictEqual(snap.data().updatedAt, 101); assert.strictEqual(snap.data().data.kg, 68);
});

/* 4 ─ Tombstones */
test('4 deletes are stored as tombstones; hard delete is refused; a newer edit can revive', async () => {
  const ref = () => recRef(db(A), A, 'sessions', 's1');
  await assertSucceeds(setDoc(ref(), rec('sessions', 's1', 100)));
  await assertFails(deleteDoc(ref()));                                                              // hard delete refused
  await assertFails(deleteDoc(doc(db(A), 'users', A)));
  await assertSucceeds(setDoc(ref(), rec('sessions', 's1', 200, { deleted: true, data: null })));   // tombstone
  const t = await assertSucceeds(getDoc(ref())); assert.strictEqual(t.data().deleted, true); assert.strictEqual(t.data().data, null);
  await assertFails(setDoc(ref(), rec('sessions', 's1', 150)));                                     // older edit cannot resurrect it
  await assertFails(setDoc(ref(), rec('sessions', 's1', 200)));                                     // equal cannot either
  await assertSucceeds(setDoc(ref(), rec('sessions', 's1', 300)));                                  // genuinely newer edit can
  assert.strictEqual((await assertSucceeds(getDoc(ref()))).data().deleted, false);
  await assertFails(deleteDoc(recRef(db(B), A, 'sessions', 's1')));
});

/* 5 ─ Transaction conflicts (same transaction body as cloud.js pushBatch) */
async function pushTx(d, uid, docsToPush) {
  const stale = [];
  await runTransaction(d, async tx => {
    stale.length = 0;
    const refs = docsToPush.map(x => recRef(d, uid, x.store, x.key));
    const snaps = await Promise.all(refs.map(r => tx.get(r)));
    docsToPush.forEach((x, i) => {
      if (snaps[i].exists()) {
        const c = snaps[i].data();
        if (c.updatedAt > x.updatedAt) { stale.push(x.key); return; }
        if (c.updatedAt === x.updatedAt) { if (!!c.deleted === !!x.deleted && JSON.stringify(c.data) === JSON.stringify(x.data)) return; stale.push(x.key); return; }
      }
      tx.set(refs[i], rec(x.store, x.key, x.updatedAt, { deleted: !!x.deleted, data: x.deleted ? null : x.data, device: x.device }));
    });
  });
  return stale;
}
test('5a two devices write the same record at the same time: the newer always survives', async () => {
  for (let round = 0; round < 5; round++) {
    await env.clearFirestore();
    const d1 = db(A), d2 = db(A);       // two phones, same account
    const key = '2026-11-0' + (round + 1);
    const w = (kg, ts, dev) => ({ store: 'weights', key, updatedAt: ts, data: { date: key, kg }, device: dev });
    const [s1, s2] = await Promise.all([pushTx(d1, A, [w(70, 1000, 'p1')]), pushTx(d2, A, [w(71, 2000, 'p2')])]);
    const final = (await getDoc(recRef(d1, A, 'weights', key))).data();
    assert.strictEqual(final.updatedAt, 2000, 'round ' + round + ': newest write must win');
    assert.strictEqual(final.data.kg, 71);
    assert.deepStrictEqual(s2, [], 'newer device is never refused');
  }
});
test('5b stale phone is told "stale" and cannot overwrite; delete vs edit is decided by timestamp', async () => {
  await pushTx(db(A), A, [{ store: 'sessions', key: 's1', updatedAt: 500, data: { id: 's1', title: 'New' }, device: 'p1' }]);
  const stale = await pushTx(db(A), A, [{ store: 'sessions', key: 's1', updatedAt: 400, data: { id: 's1', title: 'Old' }, device: 'p2' }]);
  assert.deepStrictEqual(stale, ['s1']);
  assert.strictEqual((await getDoc(recRef(db(A), A, 'sessions', 's1'))).data().data.title, 'New');
  await pushTx(db(A), A, [{ store: 'sessions', key: 's1', updatedAt: 600, deleted: true, data: null, device: 'p1' }]);
  const s2 = await pushTx(db(A), A, [{ store: 'sessions', key: 's1', updatedAt: 550, data: { id: 's1', title: 'Edit' }, device: 'p2' }]);
  assert.deepStrictEqual(s2, ['s1']);
  assert.strictEqual((await getDoc(recRef(db(A), A, 'sessions', 's1'))).data().deleted, true);
});
test('5c a retried upload whose first attempt succeeded is a no-op (no rule violation)', async () => {
  const x = { store: 'rest', key: '2026-11-06', updatedAt: 10, data: { date: '2026-11-06', markedAt: 5 }, device: 'p1' };
  assert.deepStrictEqual(await pushTx(db(A), A, [x]), []);
  assert.deepStrictEqual(await pushTx(db(A), A, [x]), []);
});
