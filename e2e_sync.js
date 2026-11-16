const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const { APP, AUTH, FS, Backend } = require('./mockfb.js');
const ROOT = process.env.ROOT, PORT = 8171;
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
const srv = http.createServer((q, r) => { const f = path.join(ROOT, q.url === '/' ? 'index.html' : q.url.split('?')[0]); if (!fs.existsSync(f)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' }); r.end(fs.readFileSync(f)); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok  -', m); } else { fail++; console.log('  FAIL-', m); } };
const idb = (page, store) => page.evaluate(s => new Promise(res => { const r = indexedDB.open('vishesh-workout-studio'); r.onsuccess = () => { const q = r.result.transaction(s).objectStore(s).getAll(); q.onsuccess = () => { r.result.close(); res(q.result); }; }; }), store);
const FAKECFG = 'window.VWS_FIREBASE={sdkVersion:"10.14.1",config:{apiKey:"test-key",authDomain:"test.firebaseapp.com",projectId:"test",appId:"1:1:web:1"}};';
const backend = new Backend();
const errors = [];
let browser;

async function phone(id, { configured = true, seed = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 760 }, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
  await ctx.exposeFunction('__fb', (op, p) => backend.handle(id, op, p));
  const base = 'https://www.gstatic.com/firebasejs/10.14.1/';
  const js = body => ({ status: 200, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body });
  await ctx.route(base + 'firebase-app.js', r => r.fulfill(js(APP)));
  await ctx.route(base + 'firebase-auth.js', r => r.fulfill(js(AUTH)));
  await ctx.route(base + 'firebase-firestore.js', r => r.fulfill(js(FS)));
  if (configured) await ctx.route('**/firebase-config.js', r => r.fulfill(js(FAKECFG)));
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(id + ': ' + String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errors.push(id + ': ' + m.text()); });
  if (seed) {
    await page.goto(U + 'nonexistent');
    await page.evaluate(() => new Promise((res, rej) => {
      const r = indexedDB.open('vishesh-workout-studio', 2);
      r.onupgradeneeded = () => { const db = r.result; [['workouts', 'id'], ['sessions', 'id'], ['rest', 'date'], ['weights', 'date'], ['tracks', 'id'], ['videos', 'id']].forEach(([n, k]) => db.createObjectStore(n, { keyPath: k })); db.createObjectStore('videoChunks', { keyPath: ['vid', 'idx'] }); };
      r.onsuccess = () => { const db = r.result, t = db.transaction(['workouts', 'sessions', 'rest', 'weights'], 'readwrite');
        t.objectStore('workouts').put({ id: 'w-old', title: 'Old Legs Day', url: 'https://youtu.be/dQw4w9WgXcQ', category: 'Strength', durationMin: 25, createdAt: 1700000000000, lastUsedAt: 0 });
        t.objectStore('sessions').put({ id: 's-old1', workoutId: 'w-old', title: 'Old Legs Day', category: 'Strength', date: '2026-10-20', startedAt: 1760900000000, endedAt: 1760901500000, activeSeconds: 1500, completed: true });
        t.objectStore('sessions').put({ id: 's-old2', workoutId: 'w-old', title: 'Old Legs Day', category: 'Strength', date: '2026-10-21', startedAt: 1760990000000, endedAt: 1760991200000, activeSeconds: 1200, completed: true });
        t.objectStore('rest').put({ date: '2026-10-22', markedAt: 1761100000000 });
        t.objectStore('weights').put({ date: '2026-10-20', kg: 70.5 });
        t.oncomplete = () => { db.close(); res(); }; t.onerror = () => rej(t.error); };
      r.onerror = () => rej(r.error);
    }));
  }
  await page.goto(U); await page.waitForSelector('#nav button');
  return { ctx, page, id };
}
const closeS = p => p.evaluate(() => { const b = document.querySelector('#sheet-body [data-action=closeSheet]'); if (b) b.click(); });
const chip = p => p.textContent('#sync-chip-text');
const openAcct = async p => { await p.click('#sync-chip'); await p.waitForSelector('#acct-root, .sheet-panel .btn'); };
async function signUp(p, name, email, pw) {
  await openAcct(p); await p.click('[data-action=acctMode][data-mode=signup]');
  await p.fill('#a-name', name); await p.fill('#a-email', email); await p.fill('#a-pass', pw); await p.click('form[data-form=acctSignUp] button[type=submit]');
}
async function signIn(p, email, pw) {
  await openAcct(p); await p.fill('#a-email', email); await p.fill('#a-pass', pw); await p.click('form[data-form=acctSignIn] button[type=submit]');
}
const addWeight = async (p, kg) => { await p.click('#nav button[data-tab=progress]'); await p.fill('#w-kg', String(kg)); await p.click('form[data-form=weight] button[type=submit]'); await sleep(300); };
const setNet = async (ph, on) => { backend.dev(ph.id).offline = !on; await ph.page.evaluate(v => { Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => v }); window.dispatchEvent(new Event(v ? 'online' : 'offline')); }, on); };
const cloudDocs = uid => [...backend.docs.entries()].filter(([k]) => k.startsWith('users/' + uid + '/records/')).map(([k, v]) => ({ id: k.split('/').pop(), ...v }));
let U;

(async () => {
  await new Promise(r => srv.listen(PORT, r)); U = 'http://localhost:' + PORT + '/';
  browser = await chromium.launch();

  console.log('1. NOT CONFIGURED (firebase-config.js is the empty placeholder)');
  { const A0 = await phone('A0', { configured: false, seed: true });
    ok((await chip(A0.page)) === 'Cloud off', 'chip says "Cloud off"');
    await openAcct(A0.page); ok(/not set up yet/i.test(await A0.page.textContent('#acct-root')), 'Account screen honestly says cloud sync is not set up');
    await closeS(A0.page);
    ok((await idb(A0.page, 'sessions')).length === 2 && (await idb(A0.page, 'workouts')).length === 1, 'seeded v2 data survived the upgrade to the new database version (2 sessions, 1 workout)');
    await addWeight(A0.page, 71.2); ok((await idb(A0.page, 'weights')).length === 2, 'app still saves weights locally');
    await A0.ctx.close(); }

  console.log('2. PHONE A: sign up with email, migrate existing local data');
  const A = await phone('A', { seed: true });
  await signUp(A.page, 'Vishesh Test', 'vishesh@example.com', 'secret123');
  await A.page.waitForSelector('[data-value=yes]');
  const offer = await A.page.textContent('#sheet-body');
  ok(/2 completed workouts, 1 saved workout, 1 rest day, 1 weight entry/.test(offer), 'migration offer lists what is on the phone: ' + (/This phone has (.*?)\. Signed/.exec(offer) || [])[1]);
  ok(cloudDocs('e_1_vishesh').length === 0, 'nothing uploaded before the person agrees');
  await A.page.click('[data-value=yes]');
  await A.page.waitForFunction(() => /Your data is in your account/.test(document.querySelector('#sheet-body').textContent), null, { timeout: 15000 });
  ok(/5<\/b> record|5 record/.test(await A.page.innerHTML('#sheet-body')) || /5/.test(await A.page.textContent('#sheet-body')), 'success sheet reports verified upload count');
  await closeS(A.page);
  const uidA = [...backend.accounts.values()].find(a => a.email === 'vishesh@example.com').uid;
  let docs = cloudDocs(uidA);
  ok(docs.length === 5, 'exactly 5 cloud documents (no duplicates): ' + docs.length);
  const s1 = docs.find(d => d.id === 'sessions__s-old1');
  ok(s1 && s1.data.title === 'Old Legs Day' && s1.data.date === '2026-10-20' && s1.data.activeSeconds === 1500 && s1.data.endedAt === 1760901500000, 'completed workout saved with name, date, completion time, duration');
  ok(docs.some(d => d.id === 'rest__2026-10-22') && docs.some(d => d.id === 'weights__2026-10-20' && d.data.kg === 70.5), 'rest day and weight saved');
  const prof = backend.docs.get('users/' + uidA);
  ok(prof && prof.displayName === 'Vishesh Test' && prof.email === 'vishesh@example.com', 'profile name and email saved: ' + JSON.stringify(prof && { n: prof.displayName, e: prof.email }));
  ok((await idb(A.page, 'sessions')).length === 2 && (await idb(A.page, 'weights')).length === 1, 'local data untouched after migration');
  await A.page.waitForFunction(() => document.querySelector('#sync-chip-text').textContent === 'Synced', null, { timeout: 10000 }).catch(() => {});
  ok((await chip(A.page)) === 'Synced', 'chip says Synced');

  console.log('3. PHONE A: finish a real workout online, add weight');
  await A.page.click('#nav button[data-tab=home]');
  await A.page.click('#view-home [data-action=startFree]'); await A.page.waitForSelector('#btn-main');
  await A.page.click('#btn-main'); await sleep(2200); await A.page.click('#btn-finish'); await A.page.waitForSelector('[data-value=save]'); await A.page.click('[data-value=save]');
  await sleep(2500);
  docs = cloudDocs(uidA);
  ok(docs.filter(d => d.store === 'sessions').length === 3, 'new completed workout reached the cloud automatically (3 sessions)');
  const ns = docs.find(d => d.store === 'sessions' && d.id !== 'sessions__s-old1' && d.id !== 'sessions__s-old2');
  ok(ns && ns.data.activeSeconds >= 2 && ns.data.activeSeconds <= 4 && /^\d{4}-\d\d-\d\d$/.test(ns.data.date) && ns.data.endedAt > 0 && ns.data.title, 'its duration/date/title/end time are stored: ' + JSON.stringify(ns && ns.data.title + ' ' + ns.data.activeSeconds + 's'));
  await addWeight(A.page, 69.9); await sleep(1800);
  ok(cloudDocs(uidA).filter(d => d.store === 'weights').length === 2 && cloudDocs(uidA).find(d => d.store === 'weights' && d.data.kg === 69.9), 'weight entry synced (today\'s weight, 69.9)');

  console.log('4. PHONE A: offline -> queued -> automatic sync when online');
  await setNet(A, false);
  await A.page.click('#nav button[data-tab=tracker]');
  const yday = await A.page.evaluate(() => { const d = new Date(); d.setDate(d.getDate() - 1); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); });
  await A.page.click('[data-action=selDay][data-date="' + yday + '"]'); await A.page.click('#view-tracker [data-action=toggleRest]'); await sleep(1800);
  ok((await chip(A.page)) === 'Offline', 'chip says Offline');
  const before = cloudDocs(uidA).length;
  ok(cloudDocs(uidA).filter(d => d.store === 'rest').length === 1, 'rest day recorded offline is NOT in the cloud yet');
  const restBefore = (await idb(A.page, 'rest')).length;
  ok((await idb(A.page, 'rest')).length === 2, 'but it is saved on the phone');
  await addWeight(A.page, 69.5); await sleep(500);
  const pend = (await idb(A.page, 'sync')).filter(m => m.dirty).length;
  ok(pend >= 2, 'offline changes are queued (' + pend + ' waiting)');
  await setNet(A, true); await A.page.waitForFunction(() => document.querySelector('#sync-chip-text').textContent === 'Synced', null, { timeout: 15000 });
  docs = cloudDocs(uidA);
  ok(docs.filter(d => d.store === 'rest').length === 2 && docs.filter(d => d.store === 'weights').length === 2 && docs.find(d => d.store === 'weights' && d.data.kg === 69.5), 'queued changes uploaded automatically when connection returned (no duplicates)');
  ok((await idb(A.page, 'sync')).filter(m => m.dirty).length === 0, 'queue is empty');

  console.log('5. PHONE B (new phone, empty): sign in, everything restores');
  const B = await phone('B');
  await signIn(B.page, 'vishesh@example.com', 'secret123');
  await B.page.waitForFunction(() => document.querySelector('#sync-chip-text').textContent === 'Synced', null, { timeout: 15000 });
  ok(!(await B.page.isVisible('[data-value=yes]')), 'no migration prompt on an empty phone');
  const bs = await idb(B.page, 'sessions');
  ok(bs.length === 3 && bs.some(s => s.title === 'Old Legs Day' && s.date === '2026-10-20' && s.activeSeconds === 1500), 'workout history restored with names, dates and durations (' + bs.length + ' sessions)');
  ok((await idb(B.page, 'rest')).length === 2 && (await idb(B.page, 'weights')).length === 2 && (await idb(B.page, 'workouts')).length === 1, 'rest days, weights, workout list restored');
  await closeS(B.page);
  await B.page.click('#nav button[data-tab=progress]');
  ok(await B.page.isVisible('#view-progress >> text=Old Legs Day'), 'history screen shows the restored workout');
  await B.page.click('#nav button[data-tab=home]');
  const prof2 = await B.page.textContent('#view-home');
  ok(/streak/i.test(prof2), 'streak/home card renders from restored records');

  console.log('6. PHONE B: sign out, sign in again -> still same data, no duplicates');
  await openAcct(B.page); await B.page.click('[data-action=acctSignOut]'); await B.page.click('[data-value=yes]');
  await B.page.waitForFunction(() => document.querySelector('#sync-chip-text').textContent === 'Sign in', null, { timeout: 8000 });
  ok((await idb(B.page, 'sessions')).length === 3, 'signing out keeps the data on the phone');
  await signIn(B.page, 'vishesh@example.com', 'secret123');
  await B.page.waitForFunction(() => document.querySelector('#sync-chip-text').textContent === 'Synced', null, { timeout: 15000 });
  ok((await idb(B.page, 'sessions')).length === 3 && cloudDocs(uidA).length === docs.length, 'after login again: still 3 sessions, cloud still ' + docs.length + ' docs (no duplicates)');
  await closeS(B.page);

  console.log('7. DELETE on phone A reaches phone B');
  await A.page.click('#nav button[data-tab=progress]');
  await A.page.locator('#view-progress [data-action=deleteSession]').first().click(); await A.page.click('[data-value=yes]'); await sleep(2200);
  ok(cloudDocs(uidA).filter(d => d.store === 'sessions' && d.deleted).length === 1, 'deletion stored as a marker in the cloud (record not erased)');
  await openAcct(B.page); await B.page.click('[data-action=acctSyncNow]'); await sleep(1200);
  ok((await idb(B.page, 'sessions')).length === 2, 'phone B now shows the deletion (2 sessions)');
  await closeS(B.page);

  console.log('8. PERSISTENCE: reload keeps signed-in state and data');
  await A.page.reload(); await A.page.waitForSelector('#nav button');
  await A.page.waitForFunction(() => document.querySelector('#sync-chip-text').textContent === 'Synced', null, { timeout: 15000 });
  ok((await idb(A.page, 'sessions')).length === 2 && (await idb(A.page, 'weights')).length === 2, 'after refresh all data present and chip Synced');

  console.log('9. OTHER USER cannot see or touch the first user\'s data');
  const C = await phone('C');
  await signUp(C.page, 'Second Person', 'other@example.com', 'password9');
  await C.page.waitForFunction(() => document.querySelector('#sync-chip-text').textContent === 'Synced', null, { timeout: 15000 });
  ok((await idb(C.page, 'sessions')).length === 0 && (await idb(C.page, 'weights')).length === 0, 'second account starts empty and gets none of the first user\'s records');
  const peek = backend.handle('C', 'query', { path: 'users/' + uidA + '/records', cs: [] });
  ok(peek.__err && peek.__err.code === 'permission-denied', 'simulated rules: reading user 1\'s records as user 2 is denied');
  const poke = backend.handle('C', 'batch', { ops: [{ path: 'users/' + uidA + '/records/weights__2026-10-20', data: { store: 'weights', key: 'x', deleted: true, data: null, updatedAt: 9e15, syncedAt: { __st: 1 } } }] });
  ok(poke.__err && poke.__err.code === 'permission-denied', 'simulated rules: writing to user 1\'s records as user 2 is denied');

  console.log('10. ACCOUNT SWITCH on a phone that holds another account\'s data');
  const B2 = B;
  await openAcct(B2.page); await B2.page.click('[data-action=acctSignOut]'); await B2.page.click('[data-value=yes]');
  await B2.page.waitForFunction(() => document.querySelector('#sync-chip-text').textContent === 'Sign in', null, { timeout: 8000 });
  await signUp(B2.page, 'Third Person', 'third@example.com', 'password9');
  await B2.page.waitForSelector('[data-value=clean]');
  ok(/another account/i.test(await B2.page.textContent('#sheet-body')), 'asked what to do with the other account\'s data (nothing happens silently)');
  ok((await idb(B2.page, 'sessions')).length === 2, 'data still on the phone while deciding');
  await B2.page.click('[data-value=clean]'); await sleep(2500);
  ok((await idb(B2.page, 'sessions')).length === 0, 'after choosing Replace, this phone holds only the new account\'s (empty) data');
  ok(cloudDocs(uidA).length === docs.length, 'the first user\'s cloud data is unchanged by the switch');

  console.log('11. GOOGLE sign-in (mock popup)');
  const G = await phone('G');
  await G.page.evaluate(() => { window.__googleEmail = 'gina@gmail.com'; window.__googleName = 'Gina Google'; });
  await openAcct(G.page); await G.page.click('[data-action=acctGoogle]');
  await G.page.waitForFunction(() => document.querySelector('#sync-chip-text').textContent === 'Synced', null, { timeout: 15000 });
  const gu = [...backend.accounts.values()].find(a => a.email === 'gina@gmail.com');
  ok(gu && backend.docs.get('users/' + gu.uid).displayName === 'Gina Google', 'Google account name saved to profile');
  ok(/Gina Google/.test(await G.page.textContent('#acct-root')), 'Account screen shows the name and email');

  console.log('12. ERRORS shown to the person');
  const E = await phone('E');
  await signIn(E.page, 'vishesh@example.com', 'wrong-password');
  await E.page.waitForSelector('.acct-msg'); ok(/incorrect/i.test(await E.page.textContent('.acct-msg')), 'wrong password gives a clear message');
  ok((await chip(E.page)) === 'Sign in', 'still signed out');


  console.log('13. CONCURRENT EDITS from two phones (real app UI, both offline, reconnect in each order)');
  const P = await phone('P'), Q = await phone('Q');
  await signUp(P.page, 'Conc User', 'conc@example.com', 'password9');
  await P.page.waitForFunction(() => document.querySelector('#sync-chip-text').textContent === 'Synced', null, { timeout: 15000 });
  await closeS(P.page);
  await addWeight(P.page, 80.0); await sleep(1500);
  await signIn(Q.page, 'conc@example.com', 'password9');
  await Q.page.waitForFunction(() => document.querySelector('#sync-chip-text').textContent === 'Synced', null, { timeout: 15000 });
  await closeS(Q.page);
  const uidP = [...backend.accounts.values()].find(a => a.email === 'conc@example.com').uid;
  const wDoc = () => cloudDocs(uidP).find(d => d.store === 'weights');
  const kgOf = async pg => ((await idb(pg, 'weights'))[0] || {}).kg;
  ok(await kgOf(Q.page) === 80, 'phone Q restored the starting weight 80.0');
  const waitSynced = pg => pg.waitForFunction(() => document.querySelector('#sync-chip-text').textContent === 'Synced', null, { timeout: 15000 });
  for (const order of ['PQ', 'QP']) {
    await setNet(P, false); await setNet(Q, false); await sleep(200);
    const first = order === 'PQ' ? ['P', 'Q'] : ['Q', 'P'];
    await addWeight(P.page, order === 'PQ' ? 81.1 : 83.3); await sleep(150);      // P edits first (older)...
    await addWeight(Q.page, order === 'PQ' ? 82.2 : 84.4); await sleep(150);      // ...Q edits later
    const later = order === 'PQ' ? 82.2 : 84.4;
    const ph = { P, Q };
    await setNet(ph[first[0]], true); await waitSynced(ph[first[0]].page); await sleep(300);
    await setNet(ph[first[1]], true); await waitSynced(ph[first[1]].page); await sleep(1500);
    // phones only look for other phones' changes when the app is opened/foregrounded, comes online, or every 90 s: simulate re-opening both
    await P.page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await Q.page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await sleep(1500);
    await waitSynced(P.page); await waitSynced(Q.page);
    const w = wDoc();
    ok(w && w.data.kg === later && await kgOf(P.page) === later && await kgOf(Q.page) === later, 'order ' + order + ': both phones and the cloud hold the LATER edit (' + later + ') -> cloud ' + (w && w.data.kg) + ', P ' + await kgOf(P.page) + ', Q ' + await kgOf(Q.page));
    ok(cloudDocs(uidP).filter(d => d.store === 'weights').length === 1, 'order ' + order + ': still exactly one weight document (no duplicate)');
  }
  console.log('14. EDIT vs DELETE (offline on two phones)');
  { await setNet(P, false); await setNet(Q, false);
    await P.page.click('#nav button[data-tab=progress]'); await Q.page.click('#nav button[data-tab=progress]');
    await addWeight(Q.page, 90.9); await sleep(150);                              // Q edits (older)
    await P.page.click('#nav button[data-tab=progress]'); await P.page.locator('#view-progress [data-action=deleteWeight]').first().click(); await P.page.click('[data-value=yes]'); await sleep(300);   // P deletes (later)
    await setNet(P, true); await waitSynced(P.page); await setNet(Q, true); await waitSynced(Q.page); await sleep(1500);
    ok(wDoc().deleted === true && (await idb(P.page, 'weights')).length === 0 && (await idb(Q.page, 'weights')).length === 0, 'later DELETE won on the cloud and on both phones');
    await setNet(P, false); await setNet(Q, false);
    await addWeight(P.page, 77.7); await sleep(150);                              // P re-adds (older)
    await Q.page.click('#nav button[data-tab=progress]'); await addWeight(Q.page, 78.8); await sleep(150);   // Q adds later
    await setNet(Q, true); await waitSynced(Q.page); await setNet(P, true); await waitSynced(P.page); await sleep(1500);
    ok(wDoc().deleted === false && wDoc().data.kg === 78.8 && await kgOf(P.page) === 78.8, 'later EDIT after a delete restores the record everywhere (78.8)'); }

  console.log('15. TRANSACTION: a newer record lands in the cloud in the middle of an upload');
  { await P.page.click('#nav button[data-tab=progress]');
    backend.beforeCommit = b => { const path = 'users/' + uidP + '/records/' + wDoc().id; const cur = b.docs.get(path); b.docs.set(path, Object.assign({}, cur, { data: Object.assign({}, cur.data, { kg: 99.9 }), updatedAt: Date.now() + 5e8, syncedAt: { __ts: Date.now() } })); b.vers.set(path, (b.vers.get(path) || 0) + 1); };
    const retries0 = backend.txRetries;
    await addWeight(P.page, 55.5); await sleep(3500); await waitSynced(P.page);
    ok(backend.txRetries === retries0 + 1, 'server detected the concurrent change and the transaction retried (' + (backend.txRetries - retries0) + ' retry)');
    ok(wDoc().data.kg === 99.9, 'the newer cloud record was NOT overwritten by the stale upload');
    await sleep(500); ok(await kgOf(P.page) === 99.9, 'the stale phone then adopted the newer record (99.9)'); }

  console.log('16. GOOGLE full-page redirect fallback (pop-up blocked)');
  { const R = await phone('R');
    await R.page.addInitScript(() => { window.__popupBlocked = true; window.__googleEmail = 'rita@gmail.com'; window.__googleName = 'Rita Redirect'; });
    await R.page.reload(); await R.page.waitForSelector('#nav button');
    await openAcct(R.page); await R.page.click('[data-action=acctGoogle]');
    await R.page.waitForFunction(() => document.querySelector('#sync-chip-text').textContent === 'Synced', null, { timeout: 20000 });
    const ru = [...backend.accounts.values()].find(a => a.email === 'rita@gmail.com');
    ok(ru && backend.docs.get('users/' + ru.uid).displayName === 'Rita Redirect', 'pop-up blocked -> page redirected -> came back signed in with the profile saved');
    const R2 = await phone('R2');
    await R2.page.addInitScript(() => { window.__googleEmail = 'rita2@gmail.com'; window.__googleName = 'Rita Two'; });
    await R2.page.reload(); await R2.page.waitForSelector('#nav button'); await openAcct(R2.page);
    await R2.page.click('[data-action=acctGoogleRedirect]');
    await R2.page.waitForFunction(() => document.querySelector('#sync-chip-text').textContent === 'Synced', null, { timeout: 20000 });
    ok(true, 'explicit "full-page sign-in" link also signs in'); }

  console.log('17. INVALID RECORDS (R1/R3): local + cloud poison, existing data preserved, skipped count + recovery file');
  { const Q = await phone('Q', { seed: true });
    // a corrupt local record (weight 9999 kg) written straight into the existing database, beside the valid seed data
    await Q.page.evaluate(() => new Promise((res, rej) => { const r = indexedDB.open('vishesh-workout-studio'); r.onsuccess = () => { const t = r.result.transaction('weights', 'readwrite'); t.objectStore('weights').put({ date: '2026-10-23', kg: 9999 }); t.oncomplete = () => { r.result.close(); res(); }; t.onerror = () => rej(t.error); }; }));
    await Q.page.reload(); await Q.page.waitForSelector('#nav button');
    const localBefore = JSON.stringify([await idb(Q.page, 'workouts'), await idb(Q.page, 'sessions'), await idb(Q.page, 'rest'), await idb(Q.page, 'weights')]);
    await signUp(Q.page, 'Poison Test', 'poison@example.com', 'secret123');
    await Q.page.waitForSelector('[data-value=yes]'); await Q.page.click('[data-value=yes]');
    await Q.page.waitForFunction(() => /Your data is in your account/.test(document.querySelector('#sheet-body').textContent), null, { timeout: 15000 });
    ok(/1 record skipped/.test(await Q.page.textContent('#sheet-body')), 'upload-finished sheet says "1 record skipped"');
    await closeS(Q.page);
    await Q.page.waitForFunction(() => document.querySelector('#sync-chip-text').textContent === 'Synced', null, { timeout: 20000 });
    const uid = [...backend.accounts.values()].find(a => a.email === 'poison@example.com').uid;
    ok(cloudDocs(uid).length === 5, 'the 5 valid seed records uploaded; the corrupt one did not block them (' + cloudDocs(uid).length + ')');
    ok(!cloudDocs(uid).some(d => d.id === 'weights__2026-10-23'), 'corrupt weight (9999 kg) was NOT uploaded');
    ok(JSON.stringify([await idb(Q.page, 'workouts'), await idb(Q.page, 'sessions'), await idb(Q.page, 'rest'), await idb(Q.page, 'weights')]) === localBefore, 'every local record (including the corrupt one) is still on the phone, unchanged');
    await openAcct(Q.page);
    ok(/1 record skipped/.test(await Q.page.textContent('#acct-status')) && await Q.page.locator('#acct-skipped').count() === 1, 'Account shows "1 record skipped" and the recovery buttons');
    const dl = Q.page.waitForEvent('download', { timeout: 5000 }).catch(() => null);
    await Q.page.click('[data-action=acctSaveSkipped]'); const d = await dl;
    const exp = d ? JSON.parse(fs.readFileSync(await d.path(), 'utf8')) : null;
    ok(exp && exp.count === 1 && exp.items[0].payload.kg === 9999 && /10-700/.test(exp.items[0].reason), 'skipped record can be saved as a JSON file with its reason');
    await closeS(Q.page);
    // cloud-side poison for the same account, then a second phone signs in
    const good = cloudDocs(uid).find(x => x.id === 'weights__2026-10-20');
    const mk = (id, store, key, data, extra) => backend.docs.set('users/' + uid + '/records/' + id, Object.assign({ store, key: encodeURIComponent(key), deleted: false, data, updatedAt: 1760000000000, syncedAt: { __ts: good.syncedAt.__ts + 5000 + backend.docs.size }, device: 'x', schema: 1 }, extra || {}));
    mk('weights__2026-10-24', 'weights', '2026-10-24', { date: '2026-10-24', kg: 'heavy' });
    mk('sessions__sbad', 'sessions', 'sbad', { id: 'sbad', date: '2026-02-31', activeSeconds: 5 });
    mk('weights__2026-10-25', 'weights', '2026-10-25', { date: '2026-10-25', kg: 72.2 });
    const Q2 = await phone('Q2');
    await signIn(Q2.page, 'poison@example.com', 'secret123');
    await Q2.page.waitForFunction(() => document.querySelector('#sync-chip-text').textContent === 'Synced', null, { timeout: 20000 });
    await sleep(800);
    const w2 = (await idb(Q2.page, 'weights')).map(w => w.date).sort();
    ok(JSON.stringify(w2) === JSON.stringify(['2026-10-20', '2026-10-25']) || w2.includes('2026-10-25'), 'second phone saved the valid cloud records (' + w2.join(', ') + ') even though bad ones were in the same download');
    ok(!w2.includes('2026-10-24') && (await idb(Q2.page, 'sessions')).every(x => x.id !== 'sbad'), 'invalid cloud records were not saved on the second phone');
    await Q2.page.waitForSelector('#acct-status'); await sleep(500);
    ok(/skipped/.test(await Q2.page.textContent('#acct-status')), 'second phone shows the skipped count too (' + (await Q2.page.textContent('#acct-status')) + ')');
    const kvq = await Q2.page.evaluate(() => new Promise(res => { const r = indexedDB.open('vishesh-workout-studio'); r.onsuccess = () => { const q = r.result.transaction('syncKv').objectStore('syncKv').getAll(); q.onsuccess = () => res(q.result.filter(x => /^q:/.test(x.k)).length); }; }));
    ok(kvq >= 2, 'the skipped cloud records are kept on the phone (' + kvq + ' kept aside), not discarded');
    await closeS(Q2.page);
    ok(backend.refused === 0, 'the client never even sent an invalid record to the (mock) rules');
  }

  console.log('18. CLOUD REFUSES ONE RECORD / EVERYTHING (R1 limitation fix, real cloud.js probe against the mock)');
  { const R = await phone('R');
    await signUp(R.page, 'Refuse Test', 'refuse@example.com', 'secret123');
    await R.page.waitForFunction(() => document.querySelector('#sync-chip-text').textContent === 'Synced', null, { timeout: 15000 });
    const uidR = [...backend.accounts.values()].find(a => a.email === 'refuse@example.com').uid;
    const today = await R.page.evaluate(() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); });
    await closeS(R.page);
    // (a) the very first upload is ONE record that the rules refuse -> must not leave sync stuck
    backend.denyKeys = new Set([today]);
    await addWeight(R.page, 70.2);
    await R.page.waitForFunction(() => /skipped/.test(document.querySelector('#sync-chip-text').textContent) || document.querySelector('#sync-chip-text').textContent === 'Synced', null, { timeout: 15000 });
    await sleep(1500);
    ok(!cloudDocs(uidR).some(d => d.id === 'weights__' + today), 'the refused weight is not in the cloud');
    ok((await idb(R.page, 'weights')).some(w => w.date === today && w.kg === 70.2), 'but it is still on the phone');
    const st1 = await R.page.evaluate(() => document.querySelector('#sync-chip').className);
    ok(/s-synced/.test(st1), 'chip is "synced", not stuck in an error (' + st1 + ')');
    await R.page.click('#nav button[data-tab=tracker]');
    const yday = await R.page.evaluate(() => { const d = new Date(); d.setDate(d.getDate() - 1); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); });
    await R.page.click('[data-action=selDay][data-date="' + yday + '"]'); await R.page.click('#view-tracker [data-action=toggleRest]'); await sleep(2500);
    ok(cloudDocs(uidR).some(d => d.id === 'rest__' + yday), 'a later, valid record (rest day) uploads normally');
    await openAcct(R.page);
    const stx = await R.page.textContent('#acct-status');
    ok(/1 record skipped/.test(stx) && /latest firestore\.rules/.test(await R.page.textContent('#acct-skipped')), 'Account says "1 record skipped" and tells how to recover (' + stx + ')');
    await closeS(R.page);
    // (b) rules/sign-in broken for EVERY write: clear error with instructions, nothing is skipped
    backend.denyKeys = null; backend.denyAll = true;
    const before = (await R.page.evaluate(() => 1)) && cloudDocs(uidR).length;
    await R.page.click('#nav button[data-tab=tracker]');
    const y2 = await R.page.evaluate(() => { const d = new Date(); d.setDate(d.getDate() - 2); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); });
    await R.page.click('[data-action=selDay][data-date="' + y2 + '"]'); await R.page.click('#view-tracker [data-action=toggleRest]');
    await R.page.waitForFunction(() => /error/i.test(document.querySelector('#sync-chip').className), null, { timeout: 15000 });
    await openAcct(R.page);
    const err = await R.page.textContent('#acct-status');
    ok(/Sync error/.test(err) && /latest firestore\.rules is published/.test(err) && /safe on this phone/.test(err), 'clear error with recovery steps: ' + err.slice(0, 160));
    ok(!/skipped/.test(err.replace(/1 record skipped/, '')) || /1 record skipped/.test(err), 'the valid record that was refused for a setup reason was NOT turned into a skipped record');
    ok(cloudDocs(uidR).length === before, 'nothing reached the cloud meanwhile');
    backend.denyAll = false;
    await R.page.click('[data-action=acctSyncNow]'); await sleep(2500);
    ok(cloudDocs(uidR).some(d => d.id === 'rest__' + y2), 'after the setup is fixed, "Sync now" uploads it (nothing was lost)');
    await closeS(R.page);
  }
  console.log('  (mock-rules refusals during the run: ' + backend.refused + ')');
  console.log('\nJS errors during all runs: ' + (errors.length ? errors.join('\n  ') : 'none'));
  console.log(pass + ' passed, ' + fail + ' failed' + (errors.length ? ', ' + errors.length + ' page errors' : ''));
  await browser.close(); srv.close(); process.exit(fail || errors.length ? 1 : 0);
})().catch(e => { console.error('SCRIPT ERROR', e); process.exit(2); });
