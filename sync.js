/* sync.js — Vishesh Workout Studio cloud-sync engine (offline-first, two-way).
 *
 * This file has NO Firebase code. It talks to two small adapters, so it can be unit-tested in Node:
 *   host  = the local database (IndexedDB wrapper in app.js)
 *   cloud = the remote store (Firestore adapter in cloud.js)
 *
 * Model
 *  - Four stores are synced: workouts, sessions, rest, weights. Songs and videos (files) never leave the phone.
 *  - Every local change writes a small "sync entry" {k, store, key, updatedAt, deleted, dirty} in the same
 *    IndexedDB transaction as the record itself (done in app.js). dirty=true means "not yet in the cloud".
 *  - Cloud has one document per record: users/{uid}/records/{store}__{key}. Deletes are tombstones
 *    (deleted:true), never real deletes, so a deletion on one phone reaches the others.
 *  - Merge rule: newest updatedAt wins, per record. Records are never merged field by field.
 *  - The engine never deletes cloud data because a local list is empty. Only an explicit single-item
 *    delete creates a tombstone. "Delete all app data" and backup "Replace" only touch this phone.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VWSSync = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SYNCED = ['workouts', 'sessions', 'rest', 'weights'];
  const SCHEMA = 1;
  const PUSH_CHUNK = 100;           // one Firestore transaction per chunk (limit 500 writes); stay well below
  const PULL_OVERLAP_MS = 60 * 1000; // re-read a minute of history on each pull; merging is idempotent
  const OP_TIMEOUT_MS = 25 * 1000;
  const KEY_MAX = 600;              // max length of the URL-encoded record key (firestore.rules uses the same number)
  const DOC_ID_MAX_BYTES = 1500;    // Firestore's limit for one path segment (document id)
  const DATA_MAX_FIELDS = 40;       // firestore.rules: data map may hold at most 40 fields
  const DATA_MAX_BYTES = 100000;    // far below Firestore's 1 MiB document limit
  const KEY_FIELD = { workouts: 'id', sessions: 'id', rest: 'date', weights: 'date' };
  const REFUSAL_CODES = /permission-denied|invalid-argument|out-of-range|failed-precondition/;

  const metaKey = (store, key) => store + '|' + key;
  // Document id inside users/{uid}/records. encodeURIComponent keeps it free of "/" characters.
  const docId = (store, key) => store + '__' + encodeURIComponent(String(key));
  function parseDocId(id) {
    const i = id.indexOf('__');
    if (i < 1) return null;
    let key;
    try { key = decodeURIComponent(id.slice(i + 2)); } catch (e) { return null; }
    return { store: id.slice(0, i), key: key };
  }
  // Firestore rejects undefined and NaN; a JSON round trip also gives us a stable form for comparing.
  function clean(rec) { return JSON.parse(JSON.stringify(rec)); }
  const same = (a, b) => JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
  function sortKeys(v) {
    if (Array.isArray(v)) return v.map(sortKeys);
    if (v && typeof v === 'object') { const o = {}; Object.keys(v).sort().forEach(k => { o[k] = sortKeys(v[k]); }); return o; }
    return v;
  }
  // A record from before sync existed has no stamp. Use the best time it carries so that a stale local
  // copy can never beat a real, newer cloud edit.
  function legacyStamp(store, rec) {
    if (!rec) return 0;
    const c = [rec.updatedAt, rec.endedAt, rec.markedAt, rec.lastUsedAt, rec.createdAt, rec.startedAt, rec.addedAt];
    let best = 0;
    c.forEach(v => { if (typeof v === 'number' && isFinite(v) && v > best) best = v; });
    return best;
  }
  // Every local change gets a stamp that is strictly newer than the version it replaces, even if this
  // phone's clock is behind the clock of the phone that wrote that version.
  function nextStamp(prev, nowMs) { return Math.max(nowMs, (typeof prev === 'number' && isFinite(prev) ? prev : 0) + 1); }
  const canon = (deleted, data) => JSON.stringify(sortKeys({ deleted: !!deleted, data: deleted ? null : data }));
  // Two different versions carry the SAME timestamp: pick one winner that every device computes identically.
  // A deletion beats an edit; otherwise the larger canonical text wins.
  function tieWinner(remote, local) {
    if (!!remote.deleted !== !!local.deleted) return remote.deleted ? 'remote' : 'local';
    return canon(remote.deleted, remote.data) > canon(local.deleted, local.data) ? 'remote' : 'local';
  }

  /* ---------------- validation (used for BOTH outgoing and incoming records) ----------------
   * Deliberately NOT Core.sanitizeImport: that function repairs records (clamps numbers, drops unknown
   * fields, forces completed:true, invents createdAt) and demands YouTube links, which is right for
   * importing a backup file but wrong for sync (it would silently change real data, or reject a valid
   * workout that uses a saved video). This validator only says yes/no and never modifies anything. */
  const isNum = v => typeof v === 'number' && isFinite(v);
  const isStr = (v, max, min) => typeof v === 'string' && v.length <= max && v.length >= (min || 0);
  function isDateStr(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const d = new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)));
    return d.toISOString().slice(0, 10) === s;
  }
  // Reason text when `key` can not be used as a cloud document key; null when fine.
  function checkKey(store, key) {
    if (KEY_FIELD[store] == null) return 'unknown store "' + String(store).slice(0, 30) + '"';
    if (typeof key !== 'string' || !key.length) return 'record key is missing';
    let enc;
    try { enc = encodeURIComponent(key); } catch (e) { return 'record key has invalid characters'; }
    if (enc.length > KEY_MAX) return 'record key is too long (' + enc.length + ' > ' + KEY_MAX + ')';
    const id = store + '__' + enc;
    if (id.length > DOC_ID_MAX_BYTES) return 'document id is too long';   // ASCII only after encoding: length == bytes
    return null;
  }
  function jsonProblem(v, depth, inArray) {
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return null;
    if (typeof v === 'number') return isFinite(v) ? null : 'a number is not finite';
    if (depth > 6) return 'data is nested too deeply';
    if (Array.isArray(v)) {
      if (inArray) return 'arrays inside arrays are not allowed';
      for (const x of v) { const r = jsonProblem(x, depth + 1, true); if (r) return r; }
      return null;
    }
    if (typeof v === 'object') {
      const proto = Object.getPrototypeOf(v);
      if (proto !== Object.prototype && proto !== null) return 'data has an unsupported object type';
      for (const k of Object.keys(v)) {
        if (!k.length || k.length > 200) return 'a field name is empty or too long';
        const r = jsonProblem(v[k], depth + 1, false); if (r) return r;
      }
      return null;
    }
    return 'data has an unsupported value (' + typeof v + ')';
  }
  const SHAPES = {
    workouts: w => !isStr(w.id, 64, 1) ? 'id must be 1-64 characters' : !isStr(w.title, 120, 1) ? 'title must be 1-120 characters'
      : (w.url != null && !isStr(w.url, 500)) ? 'url is not text (max 500)' : (w.videoId != null && !isStr(w.videoId, 64)) ? 'videoId is not text'
      : (w.category != null && !isStr(w.category, 40)) ? 'category is not text (max 40)'
      : (w.durationMin != null && !(isNum(w.durationMin) && w.durationMin >= 0 && w.durationMin <= 600)) ? 'durationMin must be 0-600'
      : (w.createdAt != null && !(isNum(w.createdAt) && w.createdAt >= 0)) ? 'createdAt is not a time'
      : (w.lastUsedAt != null && !(isNum(w.lastUsedAt) && w.lastUsedAt >= 0)) ? 'lastUsedAt is not a time' : null,
    sessions: s => !isStr(s.id, 64, 1) ? 'id must be 1-64 characters' : !isDateStr(s.date) ? 'date is not a real YYYY-MM-DD date'
      : !(isNum(s.activeSeconds) && s.activeSeconds >= 0 && s.activeSeconds <= 172800) ? 'activeSeconds must be 0-172800'
      : (s.workoutId != null && !isStr(s.workoutId, 64)) ? 'workoutId is not text' : (s.title != null && !isStr(s.title, 120)) ? 'title is not text (max 120)'
      : (s.category != null && !isStr(s.category, 40)) ? 'category is not text (max 40)'
      : (s.startedAt != null && !(isNum(s.startedAt) && s.startedAt >= 0)) ? 'startedAt is not a time'
      : (s.endedAt != null && !(isNum(s.endedAt) && s.endedAt >= 0)) ? 'endedAt is not a time' : null,
    rest: r => !isDateStr(r.date) ? 'date is not a real YYYY-MM-DD date' : (r.markedAt != null && !(isNum(r.markedAt) && r.markedAt >= 0)) ? 'markedAt is not a time' : null,
    weights: w => !isDateStr(w.date) ? 'date is not a real YYYY-MM-DD date' : !(isNum(w.kg) && w.kg >= 10 && w.kg <= 700) ? 'kg must be 10-700' : null
  };
  // -> {ok:true} | {ok:false, reason}.  `key` (optional) must equal the record's own key field.
  function validateRecord(store, rec, key) {
    const bad = r => ({ ok: false, reason: r });
    if (KEY_FIELD[store] == null) return bad('unknown store "' + String(store).slice(0, 30) + '"');
    if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return bad('record is not an object');
    const own = rec[KEY_FIELD[store]];
    const kr = checkKey(store, own); if (kr) return bad(kr);
    if (key !== undefined && key !== own) return bad('record key does not match its id');
    let n = 0; try { n = Object.keys(rec).length; } catch (e) { return bad('record can not be read'); }
    if (n > DATA_MAX_FIELDS) return bad('record has too many fields (' + n + ' > ' + DATA_MAX_FIELDS + ')');
    const jp = jsonProblem(rec, 0, false); if (jp) return bad(jp);
    if (JSON.stringify(rec).length > DATA_MAX_BYTES) return bad('record is too large');
    const sr = SHAPES[store](rec); if (sr) return bad(sr);
    return { ok: true };
  }
  function withTimeout(p, ms, label) {
    let t;
    const timeout = new Promise((_, rej) => { t = setTimeout(() => { const e = new Error((label || 'Operation') + ' timed out'); e.code = 'vws/timeout'; rej(e); }, ms); });
    return Promise.race([p, timeout]).finally(() => clearTimeout(t));
  }
  function isNetworkError(e) {
    const c = String((e && e.code) || '');
    return /unavailable|timeout|network|offline|deadline|aborted/i.test(c) || /network|offline|timed out|Failed to fetch/i.test(String((e && e.message) || ''));
  }

  function createEngine(host, opts) {
    opts = opts || {};
    const now = opts.now || (() => Date.now());
    const isOnline = opts.isOnline || (() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));
    const setT = opts.setTimeout || setTimeout, clearT = opts.clearTimeout || clearTimeout;
    const debounceMs = opts.debounceMs == null ? 700 : opts.debounceMs;
    const E = {
      cloud: null, uid: null, enabled: false,
      status: 'off', detail: '', lastSyncedAt: null, lastError: null,
      listeners: [], skipped: { in: 0, out: 0, total: 0 }
    };
    let running = null, again = false, kickTimer = null, retryTimer = null, retryN = 0;

    function setStatus(s, detail) {
      E.status = s; E.detail = detail || '';
      E.listeners.slice().forEach(fn => { try { fn(E.getState()); } catch (e) { /* ignore */ } });
    }
    E.getState = () => ({ skipped: E.skipped, status: E.status, detail: E.detail, lastSyncedAt: E.lastSyncedAt, lastError: E.lastError, uid: E.uid, enabled: E.enabled });
    E.onChange = fn => { E.listeners.push(fn); return () => { E.listeners = E.listeners.filter(x => x !== fn); }; };

    const cursorName = () => 'cursor:' + E.uid;


    /* ---- quarantine: records that can not be synced are kept (never deleted) and counted ----
     * kv entry  q:<uid>:<in|out>:<doc id>  ->  {dir, id, store, key, reason, at, updatedAt, payload, cloudRefused}
     *  out = a record on this phone that was not uploaded (the local copy is untouched)
     *  in  = a cloud document that was not saved on this phone (its content is kept in `payload`)
     * An entry only disappears when the problem is resolved (a valid version synced). */
    const qKey = (dir, id) => 'q:' + E.uid + ':' + dir + ':' + id;
    const qPrefix = () => 'q:' + E.uid + ':';
    async function qPut(dir, id, store, key, reason, updatedAt, payload, extra) {
      if (!host.kv.list) return;
      let pl = null; try { pl = clean(payload); } catch (e) { pl = { unreadable: true, text: String(payload).slice(0, 500) }; }
      await host.kv.set(qKey(dir, id), Object.assign({ dir: dir, id: id, store: store, key: key, reason: reason, at: now(), updatedAt: updatedAt || 0, payload: pl }, extra || {}));
    }
    async function qClear(dir, id) { if (host.kv.del) await host.kv.del(qKey(dir, id)); }
    async function qMap(dir) {
      const m = new Map();
      if (!host.kv.list || !E.uid) return m;
      for (const e of await host.kv.list(qPrefix() + dir + ':')) m.set(e.v.id, e.v);
      return m;
    }
    E.refreshQuarantine = async function () {
      const sk = { in: 0, out: 0, total: 0 };
      if (host.kv.list && E.uid) {
        for (const e of await host.kv.list(qPrefix())) {
          const v = e.v; if (!v) continue;
          if (v.dir === 'out' && !(await host.getRecord(v.store, v.key))) continue;   // record no longer on this phone
          sk[v.dir] = (sk[v.dir] || 0) + 1; if (v.cloudRefused) sk.refused = (sk.refused || 0) + 1;
        }
      }
      sk.total = sk.in + sk.out; E.skipped = sk;
      E.listeners.slice().forEach(fn => { try { fn(E.getState()); } catch (e) { /* ignore */ } });
      return sk;
    };
    E.quarantineList = async function () {
      const out = [];
      if (host.kv.list && E.uid) for (const e of await host.kv.list(qPrefix())) if (e.v) out.push(e.v);
      return out;
    };
    // A downloadable copy of every skipped record (and its reason) so nothing is ever only "in" the app.
    E.exportQuarantine = async function () {
      const items = await E.quarantineList();
      return { app: 'vishesh-workout-studio', kind: 'skipped-sync-records', exportedAt: new Date(now()).toISOString(), count: items.length, items: items };
    };
    // Recovery: forget "cloud refused it" so the record is tried again, and re-download everything so
    // skipped cloud records are checked again. Nothing is deleted here.
    E.retryQuarantine = async function () {
      if (host.kv.list && E.uid) for (const e of await host.kv.list(qPrefix())) if (e.v && e.v.cloudRefused) await host.kv.set(e.k, Object.assign({}, e.v, { cloudRefused: false }));
      if (E.uid) await host.kv.set(cursorName(), 0);
      return E.syncNow({ full: true });
    };

    /* ---- attach / detach ---- */
    E.attach = function (cloud, uid) {
      E.cloud = cloud; E.uid = uid; E.enabled = false; E.lastError = null; 
      setStatus('idle', '');
      E.refreshQuarantine().catch(() => {});
    };
    E.detach = function () {
      E.cloud = null; E.uid = null; E.enabled = false; E.skipped = { in: 0, out: 0, total: 0 };
      clearT(kickTimer); clearT(retryTimer); kickTimer = retryTimer = null; again = false;
      setStatus('off', '');
    };
    E.enable = function () { E.enabled = true; setStatus('idle', ''); };
    E.pause = function () { E.enabled = false; setStatus('idle', 'paused'); };

    /* ---- local summary (used by the sign-in flow) ---- */
    E.localSummary = async function () {
      const counts = {}; let total = 0;
      for (const s of SYNCED) { counts[s] = (await host.listRecords(s)).length; total += counts[s]; }
      const metas = await host.meta.all();
      return { counts: counts, total: total, dirty: metas.filter(m => m.dirty).length, metas: metas.length };
    };

    /* ---- adopt: give every local record a sync entry so it will be uploaded ---- */
    E.adoptLocal = async function () {
      let adopted = 0;
      const have = new Map((await host.meta.all()).map(m => [m.k, m]));
      const add = [];
      for (const s of SYNCED) {
        for (const rec of await host.listRecords(s)) {
          const key = host.keyOf(s, rec), k = metaKey(s, key);
          if (!have.has(k)) { add.push({ k: k, store: s, key: key, updatedAt: legacyStamp(s, rec), deleted: false, dirty: true }); adopted++; }
        }
      }
      if (add.length) await host.meta.putMany(add);
      return adopted;
    };
    // Local data previously belonged to another account and the person chose to keep it: mark everything
    // as not-yet-uploaded so it is copied into the new account. Tombstones of the old account are dropped.
    E.rebaseForNewOwner = async function () {
      const metas = await host.meta.all();
      const out = [];
      for (const m of metas) {
        if (m.deleted) await host.meta.del(m.k);
        else out.push(Object.assign({}, m, { dirty: true }));
      }
      if (out.length) await host.meta.putMany(out);
      await host.kv.set(cursorName(), 0);
    };
    // Remove this phone's copy of the synced stores (only called after explicit confirmation).
    E.wipeLocalSynced = async function () {
      for (const s of SYNCED) await host.clearStore(s);
      await host.meta.clear();
      await host.kv.set(cursorName(), 0);
    };
    E.resetCursor = async function () { await host.kv.set(cursorName(), 0); };

    /* ---- pull: cloud -> local ---- */
    E.pull = async function (o) {
      o = o || {};
      if (!E.cloud) throw new Error('Not signed in');
      const since = o.full ? 0 : Math.max(0, ((await host.kv.get(cursorName())) || 0) - PULL_OVERLAP_MS);
      const res = await withTimeout(E.cloud.fetchChanges(since), OP_TIMEOUT_MS * 3, 'Download');
      const metas = new Map((await host.meta.all()).map(m => [m.k, m]));
      const toApply = [], pushAgain = []; let conflicts = 0, rejected = 0;
      let maxSynced = (await host.kv.get(cursorName())) || 0;
      for (const d of res.docs) {
        if (typeof d.syncedAt === 'number' && d.syncedAt > maxSynced) maxSynced = d.syncedAt;
        // Check each incoming document on its own. A bad one is kept aside; the good ones still sync.
        const id = d.id || (d.store + '__' + (d.key == null ? '' : (function () { try { return encodeURIComponent(String(d.key)); } catch (e) { return '?'; } })()));
        let problem = null;
        if (d.store == null || KEY_FIELD[d.store] == null) problem = 'unknown store "' + String(d.store).slice(0, 30) + '"';
        else if (d.key == null) problem = 'record key is missing';
        else if (d.updatedAt != null && !(isNum(d.updatedAt) && d.updatedAt >= 0)) problem = 'updatedAt is not a time';
        else if (d.deleted) problem = checkKey(d.store, d.key);
        else { const v = validateRecord(d.store, d.data, d.key); if (!v.ok) problem = v.reason; }
        if (problem) { rejected++; await qPut('in', id, String(d.store), d.key == null ? null : d.key, problem, d.updatedAt, d); continue; }
        await qClear('in', id);   // a valid version arrived: the earlier problem is resolved
        const k = metaKey(d.store, d.key), m = metas.get(k);
        const local = await host.getRecord(d.store, d.key);
        const localStamp = m ? m.updatedAt : (local ? legacyStamp(d.store, local) : -1);
        const remoteStamp = typeof d.updatedAt === 'number' ? d.updatedAt : 0;
        if (!m && !local) { toApply.push(d); continue; }
        if (remoteStamp > localStamp) { toApply.push(d); continue; }
        if (remoteStamp === localStamp) {
          const localDeleted = m ? !!m.deleted : false;
          const identical = !!d.deleted === localDeleted && (localDeleted || (local && same(clean(local), d.data)));
          if (identical) {                       // really the same version: the cloud already has it
            if (m && m.dirty) pushAgain.push(Object.assign({}, m, { dirty: false }));
            continue;
          }
          // Same timestamp, DIFFERENT content: never treat as synchronized. Use the shared tie rule.
          conflicts++;
          if (tieWinner({ deleted: !!d.deleted, data: d.data }, { deleted: localDeleted, data: local ? clean(local) : null }) === 'remote') { toApply.push(d); continue; }
          // our version wins: make it strictly newer than the cloud's so the upload is accepted everywhere
          pushAgain.push({ k: k, store: d.store, key: d.key, updatedAt: remoteStamp + 1, deleted: localDeleted, dirty: true });
          continue;
        }
        // local is newer than cloud: make sure it gets pushed (only if it is tracked)
        if (m && !m.dirty) pushAgain.push(Object.assign({}, m, { dirty: true }));
      }
      if (toApply.length) await host.applyRemote(toApply.map(d => ({ store: d.store, key: d.key, deleted: !!d.deleted, data: d.deleted ? null : d.data, updatedAt: d.updatedAt || 0 })));
      if (pushAgain.length) await host.meta.putMany(pushAgain);
      if (maxSynced) await host.kv.set(cursorName(), maxSynced);
      if (toApply.length && host.onRemoteApplied) host.onRemoteApplied(toApply.length);
      await E.refreshQuarantine();
      return { fetched: res.docs.length, applied: toApply.length, conflicts: conflicts, rejected: rejected };
    };

    /* ---- push: local -> cloud ---- */
    // Sends `items` [{m, doc}] in one transaction. If the cloud refuses the batch for a reason that points to
    // the data (not the network), halve the batch until the refused record is alone. Returns {ok, failed}.
    async function sendItems(items, out) {
      try {
        const res = await withTimeout(E.cloud.pushBatch(items.map(x => x.doc)), OP_TIMEOUT_MS, 'Upload');
        const stale = new Set((res && res.stale) || []);
        const fresh = new Map((await host.meta.all()).map(mm => [mm.k, mm]));
        const done = [];
        for (const x of items) {
          const f = fresh.get(x.m.k);
          if (!stale.has(x.doc.id) && f && f.updatedAt === x.m.updatedAt && f.deleted === x.m.deleted) done.push(Object.assign({}, f, { dirty: false }));
          if (stale.has(x.doc.id)) out.stale++; else { out.ok.push(x.doc); await qClear('out', x.doc.id); }
        }
        if (done.length) await host.meta.putMany(done);
      } catch (e) {
        if (isNetworkError(e) || !REFUSAL_CODES.test(String((e && e.code) || ''))) throw e;
        if (items.length === 1) { out.failed.push({ item: items[0], error: e }); return; }
        const h = items.length >> 1;
        await sendItems(items.slice(0, h), out);
        await sendItems(items.slice(h), out);
      }
    }
    E.push = async function () {
      if (!E.cloud) throw new Error('Not signed in');
      const dirty = (await host.meta.all()).filter(m => m.dirty && SYNCED.indexOf(m.store) !== -1);
      const pushed = []; pushed.stale = 0; pushed.skipped = 0;
      const qOut = await qMap('out');
      const ready = [];
      for (const m of dirty) {
        const kr = checkKey(m.store, m.key);
        if (kr) { await qPut('out', m.store + '__' + String(m.key).slice(0, 80), m.store, m.key, kr, m.updatedAt, { meta: m }); pushed.skipped++; continue; }
        const id = docId(m.store, m.key);
        if (m.deleted) { ready.push({ m: m, doc: { id: id, store: m.store, key: m.key, deleted: true, data: null, updatedAt: m.updatedAt } }); continue; }
        const rec = await host.getRecord(m.store, m.key);
        if (!rec) { await host.meta.del(m.k); await qClear('out', id); continue; }   // nothing to upload; never invent a delete
        const v = validateRecord(m.store, rec, m.key);
        if (!v.ok) { await qPut('out', id, m.store, m.key, v.reason, m.updatedAt, rec); pushed.skipped++; continue; }
        const prev = qOut.get(id);
        if (prev && prev.cloudRefused && prev.updatedAt === m.updatedAt) { pushed.skipped++; continue; }   // cloud refused this exact version; wait for an edit or "Retry"
        ready.push({ m: m, doc: { id: id, store: m.store, key: m.key, deleted: false, data: clean(rec), updatedAt: m.updatedAt } });
      }
      for (let i = 0; i < ready.length; i += PUSH_CHUNK) {
        const chunk = ready.slice(i, i + PUSH_CHUNK), out = { ok: [], failed: [], stale: 0 };
        // The cloud adapter writes inside a transaction and refuses any record that is not newer than the
        // copy already in the cloud. It reports those ids as `stale`; they stay queued and get merged by the next pull.
        await sendItems(chunk, out);
        // Every record of the batch was refused. That is either a problem with the records or with the cloud
        // setup (rules not published, sign-in problem). Tell them apart with a harmless profile write: if that
        // works, sign-in and rules are fine and the records are the problem -> skip them (kept, Retry available).
        // If it fails or can not be done, treat it as a setup problem: show an error with instructions, skip nothing.
        if (out.failed.length && out.failed.length === chunk.length) {
          let alive = false;
          if (typeof E.cloud.probe === 'function') {
            try { await withTimeout(E.cloud.probe(), OP_TIMEOUT_MS, 'Check'); alive = true; }
            catch (pe) { if (isNetworkError(pe)) throw pe; }
          }
          if (!alive) {
            const fe = out.failed[0].error;
            throw Object.assign(new Error('The cloud refused to save your changes (' + ((fe && fe.code) || 'error') + '). Your data is safe on this phone. ' +
              'Check that you are signed in and that the latest firestore.rules is published in Firebase, then tap Sync now.'), { code: fe && fe.code });
          }
        }
        for (const f of out.failed) {
          const d = f.item.doc;
          await qPut('out', d.id, d.store, d.key, 'The cloud refused this record (' + ((f.error && f.error.code) || 'error') + ')', d.updatedAt, d.deleted ? { meta: f.item.m } : d.data, { cloudRefused: true });
          pushed.skipped++;
        }
        out.ok.forEach(d => pushed.push(d)); pushed.stale += out.stale;
      }
      await E.refreshQuarantine();
      return pushed;
    };

    // pull, push; if another device changed records in between (stale), pull again and retry a few times
    E.reconcile = async function (o) {
      const all = []; let pulled = await E.pull(o), rounds = 0, pushed;
      for (;;) {
        pushed = await E.push(); pushed.forEach(d => all.push(d));
        if (!pushed.stale || ++rounds > 3) break;
        pulled = await E.pull();
      }
      all.stale = pushed.stale || 0; all.skipped = pushed.skipped || 0; all.pulled = pulled;
      return all;
    };

    /* ---- one full cycle ---- */
    async function cycle(o) {
      if (!E.cloud || !E.enabled) return { skipped: true };
      if (!isOnline()) { setStatus('offline', ''); return { offline: true }; }
      setStatus('syncing', '');
      try {
        const pushed = await E.reconcile(o);
        if (pushed.stale) { E.lastError = 'conflict'; setStatus('error', 'Another device is changing the same records. Retrying…'); scheduleRetry(); return { pulled: pushed.pulled, pushed: pushed.length, stale: pushed.stale }; }
        E.lastSyncedAt = now(); E.lastError = null; retryN = 0;
        setStatus('synced', '');
        return { pulled: pushed.pulled, pushed: pushed.length };
      } catch (e) {
        E.lastError = (e && (e.code || e.message)) || String(e);
        if (isNetworkError(e) || !isOnline()) setStatus('offline', '');
        else setStatus('error', friendly(e));
        scheduleRetry();
        return { error: e };
      }
    }
    function friendly(e) {
      const c = String((e && e.code) || '');
      if (e && e.message && /^The cloud refused to save/.test(e.message)) return e.message;
      if (/permission-denied/.test(c)) return 'Cloud refused the request. Check that you are signed in and that the latest firestore.rules is published, then tap Sync now.';
      if (/unauthenticated/.test(c)) return 'Please sign in again.';
      if (/resource-exhausted|quota/.test(c)) return 'Free daily cloud limit reached. Sync resumes tomorrow.';
      return (e && e.message) || 'Sync failed';
    }
    function scheduleRetry() {
      clearT(retryTimer);
      const wait = Math.min(5 * 60 * 1000, 15000 * Math.pow(2, retryN++));
      retryTimer = setT(() => { E.syncNow(); }, wait);
    }
    E.syncNow = function (o) {
      if (running) { again = true; return running; }
      running = (async () => {
        let r;
        do { again = false; r = await cycle(o); o = null; } while (again && !r.error);
        return r;
      })().finally(() => { running = null; });
      return running;
    };
    // called after every local change
    E.kick = function () {
      if (!E.cloud || !E.enabled) return;
      clearT(kickTimer);
      kickTimer = setT(() => { E.syncNow(); }, debounceMs);
    };

    /* ---- migration of this phone's existing data, with read-back verification ---- */
    E.migrate = async function (progress) {
      const say = m => { if (progress) try { progress(m); } catch (e) { /* ignore */ } };
      if (!E.cloud) throw new Error('Not signed in');
      if (!isOnline()) return { ok: false, reason: 'offline' };
      setStatus('syncing', 'Uploading your data');
      try {
        say('Looking at this phone’s data…');
        const adopted = await E.adoptLocal();
        say('Checking what is already in your account…');
        say('Uploading…');
        const pushed = await E.reconcile({ full: true });   // merges cloud first; cloud data is never overwritten blindly
        if (pushed.stale) { setStatus('error', 'Another device is changing the same records'); return { ok: false, reason: 'error', error: 'Records are still changing on another device. Try again.' }; }
        say('Verifying the uploaded data…');
        const v = await E.verify(pushed);
        if (!v.ok) { setStatus('error', 'Upload could not be verified'); return { ok: false, reason: 'verify', adopted: adopted, pushed: pushed.length, missing: v.missing, mismatched: v.mismatched }; }
        await host.kv.set('migrated:' + E.uid, now());
        E.lastSyncedAt = now(); setStatus('synced', '');
        return { ok: true, adopted: adopted, pushed: pushed.length, verified: v.checked, skipped: pushed.skipped || 0 };
      } catch (e) {
        E.lastError = (e && (e.code || e.message)) || String(e);
        setStatus(isNetworkError(e) ? 'offline' : 'error', friendly(e));
        return { ok: false, reason: 'error', error: E.lastError };
      }
    };
    // Read every pushed document back from the server and compare.
    E.verify = async function (pushed) {
      if (!pushed.length) return { ok: true, checked: 0, missing: 0, mismatched: 0 };
      const got = await withTimeout(E.cloud.getDocs(pushed.map(p => p.id)), OP_TIMEOUT_MS * 3, 'Verification');
      let missing = 0, mismatched = 0;
      for (const p of pushed) {
        const g = got.get(p.id);
        if (!g) { missing++; continue; }
        if (g.updatedAt > p.updatedAt) continue;             // someone saved a newer version: fine
        if (g.updatedAt !== p.updatedAt || !!g.deleted !== !!p.deleted || (!p.deleted && !same(g.data, p.data))) mismatched++;
      }
      return { ok: missing === 0 && mismatched === 0, checked: pushed.length, missing: missing, mismatched: mismatched };
    };
    // Reads the account's whole record list (used by the "compare with cloud" check in Account)
    E.cloudCounts = async function () {
      const res = await withTimeout(E.cloud.fetchChanges(0), OP_TIMEOUT_MS * 3, 'Download');
      const c = { workouts: 0, sessions: 0, rest: 0, weights: 0 };
      res.docs.forEach(d => { if (!d.deleted && c[d.store] != null) c[d.store]++; });
      return c;
    };
    return E;
  }

  return { validateRecord: validateRecord, checkKey: checkKey, KEY_MAX: KEY_MAX, nextStamp: nextStamp, tieWinner: tieWinner, canon: canon, SYNCED: SYNCED, SCHEMA: SCHEMA, createEngine: createEngine, docId: docId, parseDocId: parseDocId, metaKey: metaKey, legacyStamp: legacyStamp, clean: clean, same: same, isNetworkError: isNetworkError };
});
