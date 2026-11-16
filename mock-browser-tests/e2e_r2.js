/* R2 browser tests: IndexedDB v2 -> v3 upgrade, future-version guard, rollback behaviour of the OLD app. No Firebase (unconfigured). */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const NEW = process.env.NEWROOT, OLD = process.env.OLDROOT;
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
let CUR = NEW;
const mk = (root, port) => new Promise(r => { const s = http.createServer((q, res) => { const f = path.join(CUR, q.url === '/' ? 'index.html' : q.url.split('?')[0]); if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' }); res.end(fs.readFileSync(f)); }).listen(port, () => r(s)); });
let pass = 0, fail = 0; const ok = (c, m) => { if (c) { pass++; console.log('  ok  -', m); } else { fail++; console.log('  FAIL-', m); } };
const DBN = 'vishesh-workout-studio';
// Blobs are compared by their ACTUAL BYTES (read with arrayBuffer, hex-encoded), not just size/type.
const dump = page => page.evaluate(n => new Promise((res, rej) => { const r = indexedDB.open(n); r.onsuccess = async () => { const db = r.result, out = { version: db.version, stores: {} };
  const hex = async b => Array.from(new Uint8Array(await b.arrayBuffer())).map(x => x.toString(16).padStart(2, '0')).join('');
  const conv = async v => { if (v instanceof Blob) return { __blobBytes: await hex(v), type: v.type, size: v.size }; if (Array.isArray(v)) return Promise.all(v.map(conv)); if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = await conv(v[k]); return o; } return v; };
  for (const s of [...db.objectStoreNames]) out.stores[s] = await new Promise(rs => { const q = db.transaction(s).objectStore(s).getAll(); q.onsuccess = async () => rs(await Promise.all(q.result.map(conv))); });
  db.close(); res(out); }; r.onerror = () => rej(r.error); }), DBN);
const seed = (page, ver, extra) => page.evaluate(([n, ver, extra]) => new Promise((res, rej) => {
  const r = indexedDB.open(n, ver);
  r.onupgradeneeded = () => { const db = r.result;
    [['workouts', 'id'], ['sessions', 'id'], ['rest', 'date'], ['weights', 'date'], ['tracks', 'id'], ['videos', 'id']].forEach(([s, k]) => db.createObjectStore(s, { keyPath: k }));
    db.createObjectStore('videoChunks', { keyPath: ['vid', 'idx'] });
    if (extra) { db.createObjectStore('sync', { keyPath: 'k' }); db.createObjectStore('syncKv', { keyPath: 'k' }); db.createObjectStore('futureStore', { keyPath: 'id' }); } };
  r.onsuccess = () => { const db = r.result, names = ['workouts', 'sessions', 'rest', 'weights', 'tracks', 'videos', 'videoChunks'].concat(extra ? ['futureStore'] : []), t = db.transaction(names, 'readwrite');
    t.objectStore('workouts').put({ id: 'w1', title: 'Legs', url: 'https://youtu.be/dQw4w9WgXcQ', videoId: null, category: 'Strength', durationMin: 25, createdAt: 1700000000000, lastUsedAt: 0 });
    t.objectStore('workouts').put({ id: 'w2', title: 'Own video', url: '', videoId: 'vid1', category: 'Other', durationMin: 10, createdAt: 1700000000001, lastUsedAt: 5 });
    t.objectStore('sessions').put({ id: 's1', workoutId: 'w1', title: 'Legs', category: 'Strength', date: '2026-10-20', startedAt: 1760900000000, endedAt: 1760901500000, activeSeconds: 1500, completed: true });
    t.objectStore('rest').put({ date: '2026-10-22', markedAt: 1761100000000 });
    t.objectStore('weights').put({ date: '2026-10-20', kg: 70.5 });
    t.objectStore('tracks').put({ id: 't1', name: 'song.wav', size: 8, type: 'audio/wav', order: 1, addedAt: 3, blob: new Blob(['RIFFDATA'], { type: 'audio/wav' }) });
    t.objectStore('videos').put({ id: 'vid1', title: 'Own video', fileName: 'a.mp4', size: 6, mime: 'video/mp4', durationSec: 12, category: '', importedAt: 4, hasBlob: true, chunkCount: 1, poster: '' });
    t.objectStore('videoChunks').put({ vid: 'vid1', idx: 0, blob: new Blob(['VIDEOB'], { type: 'video/mp4' }) });
    if (extra) t.objectStore('futureStore').put({ id: 'f1', secret: 'from-the-future' });
    t.oncomplete = () => { db.close(); res(); }; t.onerror = () => rej(t.error); }; r.onerror = () => rej(r.error); }), [DBN, ver, !!extra]);

(async () => {
  const sNew = await mk(NEW, 8181), sOld = { close() {} };   // one origin; CUR switches which app version is served
  const browser = await chromium.launch();
  const errors = [];
  const ctxFor = async () => { const c = await browser.newContext({ viewport: { width: 360, height: 760 }, serviceWorkers: 'block', acceptDownloads: true }); return c; };

  console.log('A. v2 -> v3 upgrade keeps every record (incl. tracks, videos, videoChunks blobs)');
  {
    const ctx = await ctxFor(), page = await ctx.newPage();
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto('http://localhost:8181/nonexistent'); await seed(page, 2, false);
    const before = await dump(page);
    ok(before.version === 2 && !before.stores.sync, 'seed really is a v2 database without sync stores');
    await page.goto('http://localhost:8181/'); await page.waitForSelector('#nav button'); await page.waitForTimeout(1200);
    const after = await dump(page);
    ok(after.version === 3, 'database is now version 3');
    ok(after.stores.sync && after.stores.syncKv && true, 'new stores sync + syncKv were added');
    const hx = s => Buffer.from(s, 'utf8').toString('hex');
    ok(before.stores.tracks[0].blob.__blobBytes === hx('RIFFDATA') && before.stores.videoChunks[0].blob.__blobBytes === hx('VIDEOB'), 'the dump really contains the actual audio and video BYTES (RIFFDATA / VIDEOB)');
    ok(after.stores.tracks[0].blob.__blobBytes === hx('RIFFDATA') && after.stores.videoChunks[0].blob.__blobBytes === hx('VIDEOB'), 'after the upgrade the song and the video chunk contain exactly the same bytes');
    for (const s of ['workouts', 'sessions', 'rest', 'weights', 'tracks', 'videos', 'videoChunks']) ok(JSON.stringify(after.stores[s]) === JSON.stringify(before.stores[s]), 'store "' + s + '" is identical after the upgrade, blob bytes compared (' + before.stores[s].length + ' record(s))');
    ok(!(await page.locator('.banner:has-text("Storage unavailable")').count()), 'no "Storage unavailable" banner');
    await page.click('#nav button[data-tab=workouts]'); await page.waitForTimeout(300);
    ok((await page.textContent('#app')).includes('Legs'), 'existing workout is visible in the app');
    const snap = await page.evaluate(() => new Promise(res => { const r = indexedDB.open('vws-safety-snapshot'); r.onerror = () => res(null); r.onsuccess = () => { const q = r.result.transaction('snap').objectStore('snap').get('before-v3'); q.onsuccess = () => res(q.result || null); }; }));
    ok(snap && snap.from === 2 && snap.workouts.length === 2 && snap.sessions.length === 1 && snap.weights.length === 1 && snap.tracks.length === 1 && snap.videos.length === 1, 'pre-upgrade safety copy exists with the v2 records');
    await page.click('#btn-settings').catch(() => {}); await page.waitForTimeout(300);
    const dl = page.waitForEvent('download', { timeout: 4000 }).catch(() => null);
    await page.click('[data-action=downloadSafetyCopy]').catch(() => {});
    const d = await dl; ok(!!d, 'Settings has "Download pre-update safety copy" and it downloads a file');
    if (d) { const raw = fs.readFileSync(await d.path(), 'utf8'), j = JSON.parse(raw); ok(j.app === 'vishesh-workout-studio' && j.workouts.length === 2 && j.version === 2, 'safety copy is a normal backup file the app can import');
      ok(!('tracks' in j) && !('videos' in j) && !/RIFFDATA|VIDEOB/.test(raw) && j.mediaNotIncluded.songs[0] === 'song.wav' && /NOT included/.test(j.note), 'safety copy has NO song/video data, says so in the file, and lists media names only under "mediaNotIncluded"'); }
    ok(/Songs and imported videos are NOT included/.test(await page.textContent('#sheet-body')), 'Settings states that songs and videos are NOT included in the safety copy');
    // reload: still identical, snapshot is not rewritten
    await page.reload(); await page.waitForSelector('#nav button'); await page.waitForTimeout(500);
    const again = await dump(page); ok(JSON.stringify(again.stores.workouts) === JSON.stringify(before.stores.workouts) && again.version === 3, 'second launch: still identical');
    await ctx.close();
  }

  console.log('B. database NEWER than the app (VersionError guard)');
  {
    const ctx = await ctxFor(), page = await ctx.newPage();
    page.on('pageerror', e => errors.push('B ' + String(e)));
    await page.goto('http://localhost:8181/nonexistent'); await seed(page, 4, true);
    const before = await dump(page);
    ok(before.version === 4 && before.stores.futureStore.length === 1, 'seed is a v4 database');
    await page.goto('http://localhost:8181/'); await page.waitForSelector('.newer-needed', { timeout: 5000 });
    const txt = await page.textContent('.newer-needed');
    ok(/newer version of the app is needed/i.test(txt) && /not opened it and has not changed anything/i.test(txt), 'clear "newer app version required" message is shown');
    ok(!(await page.locator('.banner:has-text("Storage unavailable")').count()) && !/Storage unavailable|data will be lost/i.test(await page.content().then(h => h.replace(/<script[\s\S]*?<\/script>/g, ''))), 'NOT treated as storage-unavailable / memory-only mode');
    ok(await page.locator('#nv-update').count() === 1 && await page.locator('#nv-reload').count() === 1, 'Update and Reload buttons are offered');
    await page.waitForTimeout(800);
    const after = await dump(page);
    ok(JSON.stringify(after) === JSON.stringify(before), 'database (version, every store, every record) is completely unchanged');
    ok(!(await page.evaluate(() => !!document.querySelector('#sheet-body [data-action=clearAll]'))), 'no Delete/Reset action is reachable on this screen');
    const snapDb = await page.evaluate(() => indexedDB.databases ? indexedDB.databases().then(l => l.map(x => x.name)) : []);
    ok(!snapDb.includes('vws-safety-snapshot'), 'no snapshot or other database was created in this state');
    await ctx.close();
  }

  console.log('C. rollback: OLD (v2) app code opening a v3 database');
  {
    const ctx = await ctxFor(), page = await ctx.newPage();
    page.on('pageerror', e => errors.push('C ' + String(e)));
    await page.goto('http://localhost:8181/nonexistent'); await seed(page, 2, false);
    await page.goto('http://localhost:8181/'); await page.waitForSelector('#nav button'); await page.waitForTimeout(800);
    const v3 = await dump(page); ok(v3.version === 3, 'user is on v3');
    CUR = OLD;
    const old = await ctx.newPage(); old.on('pageerror', () => {});
    await old.goto('http://localhost:8181/'); await old.waitForTimeout(1500);
    const oldTxt = await old.textContent('body');
    console.log('     (info) old app after rollback shows storage banner:', /Storage unavailable/i.test(oldTxt), '| shows "Legs":', oldTxt.includes('Legs'));
    const still = await dump(old);
    if (JSON.stringify(still) !== JSON.stringify(v3)) console.log('     diff: version', v3.version, still.version, Object.keys(v3.stores).map(k => k + ':' + v3.stores[k].length + '/' + (still.stores[k] || []).length).join(' '));
    ok(JSON.stringify(still) === JSON.stringify(v3), 'even then, the v3 database and all its records are untouched (nothing deleted/reset)');
    await old.close(); CUR = NEW;
    const again = await ctx.newPage(); await again.goto('http://localhost:8181/'); await again.waitForSelector('#nav button'); await again.waitForTimeout(600);
    await again.click('#nav button[data-tab=workouts]'); await again.waitForTimeout(300);
    ok((await again.textContent('#app')).includes('Legs'), 'putting the new version back shows all data again');
    await ctx.close();
  }
  console.log('\nconsole/page errors:', errors.length ? errors : 'none');
  console.log(pass + ' passed, ' + fail + ' failed'); await browser.close(); sNew.close(); sOld.close(); process.exit(fail || errors.length ? 1 : 0);
})();
