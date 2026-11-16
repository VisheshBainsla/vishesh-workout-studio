/* cloud.js — Firebase adapter for Vishesh Workout Studio (Authentication + Cloud Firestore).
 * The Firebase SDK is loaded from Google's CDN the first time it is needed, so the app starts and works
 * fully offline even if it can't be loaded. Nothing here stores secrets: it uses the public web config
 * from firebase-config.js. Data layout:  users/{uid}  (profile)   users/{uid}/records/{store}__{key}
 */
(function () {
  'use strict';
  const CFG = window.VWS_FIREBASE || { config: {} };
  const c = CFG.config || {};
  const configured = !!(c.apiKey && c.projectId && c.appId && c.authDomain);
  let sdk = null, app = null, auth = null, db = null, loading = null, redirectPromise = null, redirectError = null;

  function deviceId() {
    try {
      let d = localStorage.getItem('vws.deviceId');
      if (!d) { d = Math.random().toString(36).slice(2, 10); localStorage.setItem('vws.deviceId', d); }
      return d;
    } catch (e) { return 'dev'; }
  }

  function load() {
    if (!configured) return Promise.reject(Object.assign(new Error('Cloud sync is not set up yet'), { code: 'vws/not-configured' }));
    if (sdk) return Promise.resolve(sdk);
    if (loading) return loading;
    const base = 'https://www.gstatic.com/firebasejs/' + (CFG.sdkVersion || '10.14.1') + '/';
    loading = Promise.all([import(base + 'firebase-app.js'), import(base + 'firebase-auth.js'), import(base + 'firebase-firestore.js')])
      .then(function (m) {
        const A = m[0], Au = m[1], F = m[2];
        app = A.initializeApp(c);
        auth = Au.getAuth(app);
        // finishes a full-page Google sign-in (the fallback used when a pop-up window is not possible)
        redirectPromise = Au.getRedirectResult(auth).catch(function (e) { redirectError = e; return null; });
        try { db = F.initializeFirestore(app, { experimentalAutoDetectLongPolling: true }); } catch (e) { db = F.getFirestore(app); }
        sdk = { A: A, Au: Au, F: F };
        return sdk;
      })
      .catch(function (e) { loading = null; throw Object.assign(e instanceof Error ? e : new Error(String(e)), { code: (e && e.code) || 'vws/sdk-load-failed', sdkLoad: true }); });
    return loading;
  }

  const userOf = u => u ? { uid: u.uid, email: u.email || '', displayName: u.displayName || '' } : null;

  function friendlyAuthError(e) {
    const code = String((e && e.code) || '');
    const map = {
      'auth/email-already-in-use': 'That email already has an account. Use Sign in instead.',
      'auth/invalid-email': 'That email address does not look right.',
      'auth/weak-password': 'Choose a password with at least 6 characters.',
      'auth/missing-password': 'Enter your password.',
      'auth/invalid-credential': 'Email or password is incorrect.',
      'auth/wrong-password': 'Email or password is incorrect.',
      'auth/user-not-found': 'Email or password is incorrect.',
      'auth/too-many-requests': 'Too many attempts. Wait a few minutes and try again.',
      'auth/network-request-failed': 'No internet connection. Try again when you are online.',
      'auth/popup-closed-by-user': 'Google sign-in was closed before it finished.',
      'auth/cancelled-popup-request': 'Google sign-in was cancelled.',
      'auth/popup-blocked': 'Your browser blocked the Google sign-in window. Allow pop-ups for this site and try again.',
      'auth/unauthorized-domain': 'This website address is not in Firebase “Authorized domains”. See FIREBASE_SETUP.md, step 5.',
      'auth/operation-not-allowed': 'This sign-in method is not enabled in Firebase yet. See FIREBASE_SETUP.md.',
      'auth/user-disabled': 'This account has been disabled.',
      'auth/requires-recent-login': 'Please sign in again and retry.',
      'vws/not-configured': 'Cloud sync is not set up yet (firebase-config.js is empty).',
      'vws/sdk-load-failed': 'Could not load the sign-in service. Check your internet connection and try again.'
    };
    return map[code] || (e && e.sdkLoad ? map['vws/sdk-load-failed'] : ((e && e.message) || 'Something went wrong.'));
  }

  const Cloud = {
    configured: configured,
    friendlyAuthError: friendlyAuthError,
    // Starts listening for sign-in state. cb(null | {uid,email,displayName}) — fires from the saved session even offline.
    async onAuth(cb) {
      const s = await load();
      const unsub = s.Au.onAuthStateChanged(auth, u => cb(userOf(u)));
      await redirectPromise;
      return unsub;
    },
    takeRedirectError() { const e = redirectError; redirectError = null; return e; },
    // Pop-up first (works in most phone browsers). If the browser blocks pop-ups or cannot use them, fall back to a
    // full-page redirect: the page leaves for Google and comes back signed in. opts.redirect forces the redirect.
    async signInGoogle(opts) {
      const s = await load();
      const p = new s.Au.GoogleAuthProvider();
      p.setCustomParameters({ prompt: 'select_account' });
      if (opts && opts.redirect) { await s.Au.signInWithRedirect(auth, p); return { redirecting: true }; }
      try {
        const r = await s.Au.signInWithPopup(auth, p);
        return userOf(r.user);
      } catch (e) {
        const c = String((e && e.code) || '');
        if (c === 'auth/popup-blocked' || c === 'auth/operation-not-supported-in-this-environment' || c === 'auth/web-storage-unsupported') {
          await s.Au.signInWithRedirect(auth, p); return { redirecting: true };
        }
        throw e;
      }
    },
    async signUpEmail(name, email, password) {
      const s = await load();
      const r = await s.Au.createUserWithEmailAndPassword(auth, email, password);
      if (name) { try { await s.Au.updateProfile(r.user, { displayName: name }); } catch (e) { /* profile name is saved again below */ } }
      return { uid: r.user.uid, email: r.user.email || email, displayName: name || r.user.displayName || '' };
    },
    async signInEmail(email, password) {
      const s = await load();
      const r = await s.Au.signInWithEmailAndPassword(auth, email, password);
      return userOf(r.user);
    },
    async resetPassword(email) { const s = await load(); await s.Au.sendPasswordResetEmail(auth, email); },
    async signOut() { const s = await load(); await s.Au.signOut(auth); },
    async updateName(name) {
      const s = await load();
      if (!auth.currentUser) throw new Error('Not signed in');
      await s.Au.updateProfile(auth.currentUser, { displayName: name });
      return userOf(auth.currentUser);
    },
    currentUser() { return auth ? userOf(auth.currentUser) : null; },

    // Cloud adapter used by sync.js, bound to one signed-in user.
    makeCloud(uid) {
      const F = sdk.F;
      const col = () => F.collection(db, 'users', uid, 'records');
      const map = (id, d) => ({
        id: id, store: d.store, key: (function (k) { try { return decodeURIComponent(k); } catch (e) { return k; } })(d.key), deleted: !!d.deleted, data: d.data || null,
        updatedAt: typeof d.updatedAt === 'number' ? d.updatedAt : 0,
        syncedAt: d.syncedAt && d.syncedAt.toMillis ? d.syncedAt.toMillis() : 0
      });
      return {
        async fetchChanges(sinceMs) {
          const out = [];
          const base = [F.where('syncedAt', '>', F.Timestamp.fromMillis(sinceMs || 0)), F.orderBy('syncedAt')];
          let last = null;
          for (;;) {
            const q = last ? F.query(col(), ...base, F.startAfter(last), F.limit(500)) : F.query(col(), ...base, F.limit(500));
            const snap = await F.getDocsFromServer(q);
            snap.docs.forEach(d => out.push(map(d.id, d.data())));
            if (snap.size < 500) break;
            last = snap.docs[snap.docs.length - 1];
          }
          return { docs: out };
        },
        // One Firestore TRANSACTION per batch: read the stored copy of every record, and only write the ones that are
        // strictly newer. If another phone changes a record while this runs, Firestore retries the transaction, so a
        // stale write can never replace a newer record. Refused ids are returned as `stale` (they stay queued and
        // are merged by the next download). firestore.rules enforces the same rule on the server.
        async pushBatch(docs) {
          const dev = deviceId(), stale = [];
          const same = (window.VWSSync && VWSSync.same) || ((a, b) => JSON.stringify(a) === JSON.stringify(b));
          await F.runTransaction(db, async tx => {
            stale.length = 0;                                   // the function can run more than once
            const refs = docs.map(d => F.doc(col(), d.id));
            const snaps = await Promise.all(refs.map(r => tx.get(r)));
            docs.forEach((d, i) => {
              if (snaps[i].exists()) {
                const c = snaps[i].data();
                if (c.updatedAt > d.updatedAt) { stale.push(d.id); return; }
                if (c.updatedAt === d.updatedAt) {              // same version already stored, or a same-time conflict
                  if (!!c.deleted === !!d.deleted && (d.deleted || same(c.data, d.data))) return;
                  stale.push(d.id); return;
                }
              }
              tx.set(refs[i], {
                store: d.store, key: encodeURIComponent(String(d.key)), deleted: !!d.deleted, data: d.deleted ? null : d.data,
                updatedAt: d.updatedAt, syncedAt: F.serverTimestamp(), device: dev, schema: 1
              });
            });
          });
          return { stale: stale.slice() };
        },
        async getDocs(ids) {
          const res = new Map();
          for (let i = 0; i < ids.length; i += 25) {
            await Promise.all(ids.slice(i, i + 25).map(async id => {
              const s = await F.getDocFromServer(F.doc(col(), id));
              if (s.exists()) res.set(id, map(id, s.data()));
            }));
          }
          return res;
        },
        async saveProfile(p) {
          const body = { displayName: p.displayName || '', email: p.email || '', updatedAt: Date.now(), schema: 1 };
          if (typeof p.goalMin === 'number') body.goalMin = p.goalMin;
          await F.setDoc(F.doc(db, 'users', uid), body, { merge: true });
        },
        // Harmless "are my sign-in and the rules working at all?" check: re-saves the existing profile unchanged
        // (or creates the basic one). Used only to tell "the cloud refuses everything" from "it refuses one record".
        async probe() {
          let cur = null;
          try { const snap = await F.getDocFromServer(F.doc(db, 'users', uid)); cur = snap.exists() ? snap.data() : null; } catch (e) { throw e; }
          const u = auth.currentUser || {};
          const body = cur ? { displayName: cur.displayName || '', email: cur.email || '', updatedAt: typeof cur.updatedAt === 'number' ? cur.updatedAt : Date.now(), schema: 1 }
                           : { displayName: u.displayName || '', email: u.email || '', updatedAt: Date.now(), schema: 1 };
          if (cur && typeof cur.goalMin === 'number') body.goalMin = cur.goalMin;
          await F.setDoc(F.doc(db, 'users', uid), body, { merge: true });
        },
        async getProfile() {
          const snap = await F.getDocFromServer(F.doc(db, 'users', uid));
          return snap.exists() ? snap.data() : null;
        }
      };
    },
    load: load
  };
  window.VWSCloud = Cloud;
})();
