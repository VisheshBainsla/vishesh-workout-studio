/* Service-worker update transitions with a REAL service worker in headless Chromium (served over http://localhost).
 * NEW = the final files. OLD1 = your live repo files. OLD2 = a package that has the SAME sw.js VERSION as the previous
 * delivery ('2026-11-15-v1') but older app/sync/cloud code. Env: NEWROOT, LIVEROOT, PREVROOT(=deliver 11-10 files for old code). */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const NEW = process.env.NEWROOT, LIVE = process.env.LIVEROOT, OLDCODE = process.env.OLDCODE;
const WORK = path.join(__dirname, 'sw-work'); fs.rmSync(WORK, { recursive: true, force: true }); fs.mkdirSync(WORK);
const cp = (src, name) => { const d = path.join(WORK, name); fs.cpSync(src, d, { recursive: true, filter: s => !/node_modules|\.git$|emulator-tests|mock-browser-tests/.test(s) }); return d; };
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.json': 'application/json' };
let CUR = null;
const srv = http.createServer((q, r) => { const f = path.join(CUR, q.url === '/' ? 'index.html' : q.url.split('?')[0]); if (!fs.existsSync(f)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' }); r.end(fs.readFileSync(f)); });
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log(c ? '  ok  -' : '  FAIL-', m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ver = root => /const VERSION = '([^']+)'/.exec(fs.readFileSync(path.join(root, 'sw.js'), 'utf8'))[1];
const SHELL = ['index.html', 'styles.css', 'core.js', 'firebase-config.js', 'sync.js', 'cloud.js', 'app.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];
const hasUpd = p => p.evaluate(() => navigator.serviceWorker.getRegistration().then(r => r.update()));
const state = p => p.evaluate(async () => ({ keys: await caches.keys(), sync: typeof window.VWSSync, validate: window.VWSSync && typeof window.VWSSync.validateRecord, cloud: typeof window.VWSCloud, chip: !!document.querySelector('#sync-chip'), title: document.title }));

(async () => {
  await new Promise(r => srv.listen(8160, r));
  const b = await chromium.launch();
  const NEWV = ver(NEW);
  console.log('new VERSION =', NEWV, '| live repo =', ver(LIVE), '| previous delivery =', '2026-11-15-v1');
  ok(NEWV !== '2026-11-15-v1' && NEWV !== ver(LIVE) && NEWV !== '2026-11-10-v1', 'new VERSION is unique (differs from every earlier value)');

  /* ---- 1. live repo (old cached app) -> new version ---- */
  console.log('1. YOUR LIVE SITE (cached) -> NEW VERSION');
  {
    const A = cp(LIVE, 'live'), N = cp(NEW, 'new'); CUR = A;
    const ctx = await b.newContext({ viewport: { width: 393, height: 800 } }), p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e)));
    await p.goto('http://localhost:8160/'); await p.waitForSelector('#nav button'); await p.evaluate(() => navigator.serviceWorker.ready); await p.reload(); await p.waitForSelector('#nav button');
    let s = await state(p); ok(s.keys.length === 1 && s.keys[0] === 'vws-' + ver(LIVE) && !s.chip && s.sync === 'undefined', 'old app running from its cache ' + s.keys.join(','));
    // data the user already has (written through the old app's own database, v2)
    await p.evaluate(() => new Promise((res, rej) => { const r = indexedDB.open('vishesh-workout-studio'); r.onsuccess = () => { const t = r.result.transaction('weights', 'readwrite'); t.objectStore('weights').put({ date: '2026-10-20', kg: 70.5 }); t.oncomplete = () => { r.result.close(); res(); }; t.onerror = () => rej(t.error); }; }));
    CUR = N;                                                   // "publish" the new files
    await hasUpd(p); await p.waitForSelector('#update-banner:not([hidden])', { timeout: 20000 });
    ok(true, 'update banner appears');
    s = await state(p); ok(!s.chip && s.sync === 'undefined', 'running page is still the OLD version until the person taps Update');
    ok(s.keys.length === 2 && s.keys.includes('vws-' + NEWV), 'new cache vws-' + NEWV + ' staged beside the old one');
    // content of the NEW cache = the new files, byte for byte
    const inCache = await p.evaluate(async (name) => { const c = await caches.open(name), o = {}; for (const rq of await c.keys()) o[new URL(rq.url).pathname] = Array.from(new Uint8Array(await (await c.match(rq)).arrayBuffer())); return o; }, 'vws-' + NEWV);
    for (const f of SHELL) { const got = inCache['/' + f]; ok(got && Buffer.compare(Buffer.from(got), fs.readFileSync(path.join(N, f))) === 0, 'new cache holds the NEW ' + f + ' (' + (got ? got.length : 0) + ' bytes, identical to the file)'); }
    ok(Buffer.compare(Buffer.from(inCache['/'] || inCache['/index.html'] || []), fs.readFileSync(path.join(N, 'index.html'))) === 0, 'new cache entry for "./" is the new index.html');
    await p.click('[data-action=applyUpdate]');   // no running timer -> no confirmation sheet (that case is covered by e2e_update.js)
    await p.waitForFunction(() => !!document.querySelector('#sync-chip') && !!window.VWSSync, null, { timeout: 20000 });
    await p.waitForSelector('#nav button'); await sleep(800);
    s = await state(p); ok(s.chip && s.sync === 'object' && s.validate === 'function' && s.cloud === 'object', 'after Update now: new index.html + sync.js + cloud.js + app.js are running (chip, VWSSync.validateRecord, VWSCloud present)');
    ok(s.keys.length === 1 && s.keys[0] === 'vws-' + NEWV, 'old cache removed, only ' + s.keys.join(',') + ' remains');
    const cfg = await p.evaluate(() => typeof window.VWS_FIREBASE_CONFIG !== 'undefined' || typeof window.firebaseConfig !== 'undefined' || document.scripts.length);
    ok(await p.evaluate(() => [...document.scripts].some(x => /firebase-config\.js/.test(x.src))) && !!cfg, 'firebase-config.js is loaded by the page');
    const dbv = await p.evaluate(() => new Promise(res => { const r = indexedDB.open('vishesh-workout-studio'); r.onsuccess = () => { const db = r.result, v = db.version, n = [...db.objectStoreNames]; const q = db.transaction('weights').objectStore('weights').getAll(); q.onsuccess = () => { db.close(); res({ v, n, w: q.result }); }; }; }));
    ok(dbv.v === 3 && dbv.n.includes('sync') && dbv.w.length === 1 && dbv.w[0].kg === 70.5, 'the existing weight is still there; database upgraded to v3');
    // OFFLINE after the update: everything must come from the new cache
    await ctx.setOffline(true); await p.reload(); await p.waitForSelector('#nav button', { timeout: 15000 });
    s = await state(p); ok(s.chip && s.sync === 'object' && s.validate === 'function' && s.cloud === 'object', 'OFFLINE reload: app opens from the new cache incl. sync.js, cloud.js, firebase-config.js');
    ok(errs.length === 0, 'no JS errors ' + errs.join('|'));
    await ctx.close();
  }

  /* ---- 2. the trap: same sw.js (same VERSION) but changed app files => NO update is ever seen ---- */
  console.log('2. WHY THE BUMP MATTERS: same VERSION, changed app files');
  {
    const P = cp(NEW, 'prev-same'); fs.writeFileSync(path.join(P, 'sw.js'), fs.readFileSync(path.join(P, 'sw.js'), 'utf8').replace(NEWV, '2026-11-15-v1'));
    for (const f of ['sync.js', 'cloud.js', 'app.js']) fs.copyFileSync(path.join(OLDCODE, f), path.join(P, f));       // older code of the same package
    CUR = P;
    const ctx = await b.newContext({ viewport: { width: 393, height: 800 } }), p = await ctx.newPage();
    await p.goto('http://localhost:8160/'); await p.waitForSelector('#nav button'); await p.evaluate(() => navigator.serviceWorker.ready); await p.reload(); await p.waitForSelector('#nav button');
    let s = await state(p); ok(s.keys[0] === 'vws-2026-11-15-v1' && s.validate === 'undefined', 'installed: package with VERSION 2026-11-15-v1 and OLD sync code (no validateRecord)');
    fs.writeFileSync(path.join(P, 'sync.js'), fs.readFileSync(path.join(NEW, 'sync.js')));                                // publish newer sync.js/app.js/cloud.js but keep sw.js bytes
    fs.copyFileSync(path.join(NEW, 'app.js'), path.join(P, 'app.js')); fs.copyFileSync(path.join(NEW, 'cloud.js'), path.join(P, 'cloud.js'));
    await hasUpd(p); await sleep(2500);
    ok(await p.isHidden('#update-banner'), 'no update banner is shown (browser sees an identical sw.js)');
    await p.reload(); await p.waitForSelector('#nav button'); s = await state(p);
    ok(s.validate === 'undefined' && s.keys.length === 1, 'and the phone keeps running the OLD cached sync.js — this is the problem the version bump fixes');
    await ctx.close();
  }

  /* ---- 3. previous delivery (11-15-v1 with old code) -> new bumped version ---- */
  console.log('3. PREVIOUS DELIVERY (2026-11-15-v1) -> NEW (' + NEWV + ')');
  {
    const P = cp(NEW, 'prev'); fs.writeFileSync(path.join(P, 'sw.js'), fs.readFileSync(path.join(P, 'sw.js'), 'utf8').replace(NEWV, '2026-11-15-v1'));
    for (const f of ['sync.js', 'cloud.js', 'app.js']) fs.copyFileSync(path.join(OLDCODE, f), path.join(P, f)); CUR = P;
    const ctx = await b.newContext({ viewport: { width: 393, height: 800 } }), p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e)));
    await p.goto('http://localhost:8160/'); await p.waitForSelector('#nav button'); await p.evaluate(() => navigator.serviceWorker.ready); await p.reload(); await p.waitForSelector('#nav button');
    let s = await state(p); ok(s.keys[0] === 'vws-2026-11-15-v1' && s.validate === 'undefined', 'installed: old code under VERSION 2026-11-15-v1');
    CUR = path.join(WORK, 'new');
    await hasUpd(p); await p.waitForSelector('#update-banner:not([hidden])', { timeout: 20000 }); ok(true, 'update banner appears this time');
    await p.click('[data-action=applyUpdate]');   // no running timer -> no confirmation sheet (that case is covered by e2e_update.js)
    await p.waitForFunction(() => window.VWSSync && typeof window.VWSSync.validateRecord === 'function', null, { timeout: 20000 }); await p.waitForSelector('#nav button');
    s = await state(p); ok(s.validate === 'function' && s.keys.length === 1 && s.keys[0] === 'vws-' + NEWV, 'new code is running, old cache deleted (' + s.keys.join(',') + ')');
    ok(errs.length === 0, 'no JS errors ' + errs.join('|'));
    await ctx.close();
  }
  console.log(`\n${pass} passed, ${fail} failed`); await b.close(); srv.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e.message.split('\n').slice(0, 8).join(' | ')); process.exit(2); });
