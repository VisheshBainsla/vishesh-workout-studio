/* A MOCK of the Firebase web SDK (the functions cloud.js uses) plus a mock server with simulated security rules.
 * It lets the real app code run end-to-end in Chromium. It is NOT Firebase: it proves the app's wiring and
 * sync behaviour, not that Google's services accept the calls. */
const APP = `export const initializeApp = c => ({ config: c });`;
const AUTH = `
const rpc = async (op, p) => { const r = await window.__fb(op, p || {}); if (r && r.__err) throw Object.assign(new Error(r.__err.message), { code: r.__err.code }); return r; };
const KEY = 'mockfb.user';
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; } };
const auth = { currentUser: null };
const wrap = u => u && ({ uid: u.uid, email: u.email, displayName: u.displayName || null });
const cbs = [];
const setUser = u => { auth.currentUser = u ? wrap(u) : null; if (u) localStorage.setItem(KEY, JSON.stringify(auth.currentUser)); else localStorage.removeItem(KEY); cbs.forEach(cb => setTimeout(() => cb(auth.currentUser), 0)); };
export const getAuth = () => auth;
export class GoogleAuthProvider { setCustomParameters() {} }
export const signInWithPopup = async () => { if (window.__popupBlocked) throw Object.assign(new Error('blocked'), { code: 'auth/popup-blocked' }); const r = await rpc('google', { email: window.__googleEmail, name: window.__googleName }); setUser(r); return { user: auth.currentUser }; };
export const signInWithRedirect = async () => { localStorage.setItem('mockfb.redirect', JSON.stringify({ email: window.__googleEmail, name: window.__googleName })); setTimeout(() => location.reload(), 0); await new Promise(() => {}); };
export const getRedirectResult = async () => { const p = localStorage.getItem('mockfb.redirect'); if (!p) return null; localStorage.removeItem('mockfb.redirect'); const j = JSON.parse(p); const r = await rpc('google', j); setUser(r); return { user: auth.currentUser }; };
export const createUserWithEmailAndPassword = async (a, email, pw) => { const r = await rpc('signup', { email, pw }); setUser(r); return { user: auth.currentUser }; };
export const signInWithEmailAndPassword = async (a, email, pw) => { const r = await rpc('signin', { email, pw }); setUser(r); return { user: auth.currentUser }; };
export const updateProfile = async (u, p) => { await rpc('updateProfile', p); auth.currentUser.displayName = p.displayName; localStorage.setItem(KEY, JSON.stringify(auth.currentUser)); };
export const sendPasswordResetEmail = async (a, email) => { await rpc('reset', { email }); };
export const signOut = async () => { await rpc('signout'); setUser(null); };
export const onAuthStateChanged = (a, cb) => { cbs.push(cb); (async () => { const u = load(); if (u) { await window.__fb('restore', { uid: u.uid }); auth.currentUser = u; } setTimeout(() => cb(auth.currentUser), 0); })(); return () => {}; };
`;
const FS = `
const rpc = async (op, p) => { const r = await window.__fb(op, p || {}); if (r && r.__err) throw Object.assign(new Error(r.__err.message), { code: r.__err.code }); return r; };
export class Timestamp { constructor(ms) { this.ms = ms; } toMillis() { return this.ms; } static fromMillis(ms) { return new Timestamp(ms); } }
const ST = { __sentinel: 'serverTimestamp' };
export const serverTimestamp = () => ST;
const enc = v => v === ST ? { __st: 1 } : v instanceof Timestamp ? { __ts: v.ms } : Array.isArray(v) ? v.map(enc) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => [k, enc(x)])) : v;
const dec = v => v && typeof v === 'object' ? (v.__ts !== undefined ? new Timestamp(v.__ts) : Array.isArray(v) ? v.map(dec) : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, dec(x)]))) : v;
export const getFirestore = () => ({}); export const initializeFirestore = () => ({});
export const collection = (db, ...p) => ({ path: p.join('/') });
export const doc = (a, ...p) => { const path = a.path ? [a.path, ...p].join('/') : p.join('/'); return { path, id: path.split('/').pop() }; };
export const where = (f, op, v) => ({ t: 'where', f, op, v: enc(v) });
export const orderBy = f => ({ t: 'orderBy', f });
export const limit = n => ({ t: 'limit', n });
export const startAfter = d => ({ t: 'startAfter', id: d.id, syncedAt: d._data.syncedAt && d._data.syncedAt.toMillis ? d._data.syncedAt.toMillis() : 0 });
export const query = (c, ...cs) => ({ path: c.path, cs });
const snapDoc = d => { const data = dec(d.data); return { id: d.id, _data: data, data: () => data, exists: () => true }; };
export const getDocsFromServer = async q => { const r = await rpc('query', { path: q.path, cs: q.cs }); const docs = r.docs.map(snapDoc); return { docs, size: docs.length }; };
export const getDocFromServer = async ref => { const r = await rpc('get', { path: ref.path }); if (!r.doc) return { exists: () => false, data: () => undefined }; const d = snapDoc(r.doc); return d; };
export const runTransaction = async (db, fn) => {
  for (let i = 0; i < 5; i++) {
    const reads = {}, ops = [];
    const tx = { get: async ref => { const r = await rpc('get', { path: ref.path }); reads[ref.path] = r.ver || 0; if (!r.doc) return { exists: () => false, data: () => undefined }; return snapDoc(r.doc); }, set(ref, data) { ops.push({ path: ref.path, data: enc(data), merge: false }); return tx; } };
    const out = await fn(tx);
    const r = await rpc('txcommit', { reads, ops });
    if (!r.conflict) return out;
  }
  throw Object.assign(new Error('transaction aborted'), { code: 'aborted' });
};
export const writeBatch = () => { const ops = []; return { set(ref, data, opts) { ops.push({ path: ref.path, data: enc(data), merge: !!(opts && opts.merge) }); return this; }, commit: async () => { await rpc('batch', { ops }); } }; };
export const setDoc = async (ref, data, opts) => { await rpc('batch', { ops: [{ path: ref.path, data: enc(data), merge: !!(opts && opts.merge) }] }); };
`;

class Backend {
  constructor() { this.accounts = new Map(); this.docs = new Map(); this.devs = new Map(); this.log = []; this.counter = 0; this.vers = new Map(); this.beforeCommit = null; this.txRetries = 0; this.refused = 0; }
  dev(id) { if (!this.devs.has(id)) this.devs.set(id, { uid: null, offline: false, id, reads: 0, writes: 0 }); return this.devs.get(id); }
  err(code, message) { return { __err: { code, message: message || code } }; }
  now() { return Date.now(); }
  // simulated rules: only the signed-in owner may touch users/{uid}/**, with the same field checks as firestore.rules
  allow(dev, path, write, data, merge) {
    const m = /^users\/([^/]+)(\/records\/([^/]+))?$/.exec(path);
    if (!m || !dev.uid || dev.uid !== m[1]) return false;
    if (!write) return true;
    if (this.denyAll) return false;                                                        // test hook: rules/sign-in broken for every write
    if (!m[2]) { const k = Object.keys(data); return k.every(x => ['displayName', 'email', 'updatedAt', 'schema', 'goalMin'].includes(x)) && typeof data.displayName === 'string' && typeof data.email === 'string'; }
    const rid = m[3], k = Object.keys(data);
    if (typeof data.key !== 'string' || data.key.length > 600 || !/^[A-Za-z0-9_.!~*'()%-]+$/.test(data.key) || rid !== data.store + '__' + data.key) return false;   // rules: id must equal store__key
    if (this.denyKeys && this.denyKeys.has(decodeURIComponent(data.key))) return false;                                       // test hook: the rules refuse this one key
    if (data.data && Object.keys(data.data).length > 40) return false;                                                                       // rules: data <= 40 fields
    const cur = this.docs.get(path);
    if (cur && !(typeof data.updatedAt === 'number' && data.updatedAt > cur.updatedAt)) { this.refused++; return false; }   // rules: must be strictly newer
    return k.every(x => ['store', 'key', 'deleted', 'data', 'updatedAt', 'syncedAt', 'device', 'schema'].includes(x)) &&
      ['workouts', 'sessions', 'rest', 'weights'].includes(data.store) && /^(workouts|sessions|rest|weights)__.+/.test(rid) && rid.split('__')[0] === data.store &&
      typeof data.key === 'string' && typeof data.deleted === 'boolean' && (data.data === null || (typeof data.data === 'object' && !Array.isArray(data.data))) && typeof data.updatedAt === 'number' && data.syncedAt && data.syncedAt.__st === 1;
  }
  handle(devId, op, p) {
    const dev = this.dev(devId);
    const net = () => dev.offline ? this.err('unavailable', 'offline') : null;
    switch (op) {
      case 'restore': dev.uid = p.uid; return {};
      case 'google': { if (dev.offline) return this.err('auth/network-request-failed'); const uid = 'g_' + p.email; if (!this.accounts.has(p.email)) this.accounts.set(p.email, { uid, email: p.email, displayName: p.name, google: true }); dev.uid = uid; const a = this.accounts.get(p.email); return { uid, email: a.email, displayName: a.displayName }; }
      case 'signup': { if (dev.offline) return this.err('auth/network-request-failed'); if (this.accounts.has(p.email)) return this.err('auth/email-already-in-use'); if (!p.pw || p.pw.length < 6) return this.err('auth/weak-password'); const uid = 'e_' + (++this.counter) + '_' + p.email.split('@')[0]; this.accounts.set(p.email, { uid, email: p.email, pw: p.pw, displayName: null }); dev.uid = uid; return { uid, email: p.email, displayName: null }; }
      case 'signin': { if (dev.offline) return this.err('auth/network-request-failed'); const a = this.accounts.get(p.email); if (!a || a.pw !== p.pw) return this.err('auth/invalid-credential'); dev.uid = a.uid; return { uid: a.uid, email: a.email, displayName: a.displayName }; }
      case 'updateProfile': { const a = [...this.accounts.values()].find(x => x.uid === dev.uid); if (a) a.displayName = p.displayName; return {}; }
      case 'reset': return {};
      case 'signout': dev.uid = null; return {};
      case 'get': { const e = net(); if (e) return e; if (!this.allow(dev, p.path, false)) return this.err('permission-denied', 'Missing or insufficient permissions.'); dev.reads++; const d = this.docs.get(p.path); return { doc: d ? { id: p.path.split('/').pop(), data: d } : null, ver: this.vers.get(p.path) || 0 }; }
      case 'txcommit': {
        const e = net(); if (e) return e;
        if (this.beforeCommit) { const f = this.beforeCommit; this.beforeCommit = null; f(this); }
        for (const [path, ver] of Object.entries(p.reads)) if ((this.vers.get(path) || 0) !== ver) { this.txRetries++; return { conflict: true }; }
        for (const o of p.ops) if (!this.allow(dev, o.path, true, o.data, false)) return this.err('permission-denied', 'Missing or insufficient permissions.');
        const ts = this.now();
        p.ops.forEach(o => { const d = JSON.parse(JSON.stringify(o.data)); Object.keys(d).forEach(k => { if (d[k] && d[k].__st) d[k] = { __ts: ts }; }); this.docs.set(o.path, d); this.vers.set(o.path, (this.vers.get(o.path) || 0) + 1); dev.writes++; });
        return {};
      }
      case 'query': {
        const e = net(); if (e) return e; if (!this.allow(dev, p.path + '/x', false) && !(dev.uid && p.path === 'users/' + dev.uid + '/records')) return this.err('permission-denied', 'Missing or insufficient permissions.');
        let since = 0, lim = 1e9, after = null; p.cs.forEach(c => { if (c.t === 'where') since = c.v.__ts; if (c.t === 'limit') lim = c.n; if (c.t === 'startAfter') after = c; });
        let rows = [...this.docs.entries()].filter(([k]) => k.startsWith(p.path + '/')).map(([k, d]) => ({ id: k.split('/').pop(), data: d, ts: d.syncedAt.__ts })).filter(r => r.ts > since).sort((a, b) => a.ts - b.ts || (a.id < b.id ? -1 : 1));
        if (after) rows = rows.filter(r => r.ts > after.syncedAt || (r.ts === after.syncedAt && r.id > after.id));
        rows = rows.slice(0, lim); dev.reads += rows.length; return { docs: rows.map(r => ({ id: r.id, data: r.data })) };
      }
      case 'batch': {
        const e = net(); if (e) return e;
        for (const o of p.ops) { const data = o.merge && this.docs.get(o.path) ? Object.assign({}, this.docs.get(o.path), o.data) : o.data; if (!this.allow(dev, o.path, true, o.data, o.merge)) return this.err('permission-denied', 'Missing or insufficient permissions.'); }
        const ts = this.now();
        p.ops.forEach(o => { const d = JSON.parse(JSON.stringify(o.data)); Object.keys(d).forEach(k => { if (d[k] && d[k].__st) d[k] = { __ts: ts }; }); this.docs.set(o.path, o.merge && this.docs.get(o.path) ? Object.assign({}, this.docs.get(o.path), d) : d); this.vers.set(o.path, (this.vers.get(o.path) || 0) + 1); dev.writes++; });
        return {};
      }
    }
    return this.err('unimplemented', op);
  }
}
module.exports = { APP, AUTH, FS, Backend };
