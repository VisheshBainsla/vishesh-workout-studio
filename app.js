/* app.js — Vishesh Workout Studio UI.
 * No backend, no API keys. Structured data -> IndexedDB, light preferences -> localStorage.
 */
(function () {
  'use strict';
  const C = window.Core;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const todayStr = () => C.toDateStr(new Date());

  /* ---------------- icons ---------------- */
  const ICONS = {
    home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>',
    dumbbell: '<path d="M6.5 6.5v11M17.5 6.5v11M3 9v6M21 9v6M6.5 12h11"/>',
    music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    chart: '<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/>',
    play: '<path d="M7 4l13 8-13 8z" fill="currentColor"/>',
    pause: '<rect x="6" y="4" width="4" height="16" fill="currentColor"/><rect x="14" y="4" width="4" height="16" fill="currentColor"/>',
    next: '<path d="M5 4l10 8-10 8z" fill="currentColor"/><path d="M19 5v14"/>',
    prev: '<path d="M19 4L9 12l10 8z" fill="currentColor"/><path d="M5 5v14"/>',
    shuffle: '<path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>',
    repeat: '<path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 014-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 01-4 4H3"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>',
    x: '<path d="M18 6L6 18M6 6l12 12"/>',
    sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
    flame: '<path d="M12 2c1 4 5 5 5 10a5 5 0 01-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-4-1-6 1-9z"/>',
    check: '<path d="M20 6L9 17l-5-5"/>',
    moon: '<path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z"/>',
    download: '<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>',
    upload: '<path d="M12 15V3M7 8l5-5 5 5M4 21h16"/>',
    external: '<path d="M14 3h7v7M21 3l-9 9M19 14v6H4V5h6"/>',
    left: '<path d="M15 18l-6-6 6-6"/>',
    right: '<path d="M9 18l6-6-6-6"/>'
  };
  const icon = (n, size) => '<svg class="ic" viewBox="0 0 24 24" width="' + (size || 22) + '" height="' + (size || 22) +
    '" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[n] + '</svg>';

  /* ---------------- preferences (localStorage, guarded) ---------------- */
  const Prefs = {
    get(k, d) { try { const v = localStorage.getItem('vws.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('vws.' + k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    remove(k) { try { localStorage.removeItem('vws.' + k); } catch (e) { /* ignore */ } },
    clearAll() { try { Object.keys(localStorage).filter(k => k.indexOf('vws.') === 0).forEach(k => localStorage.removeItem(k)); } catch (e) { /* ignore */ } }
  };

  /* ---------------- IndexedDB with in-memory fallback ---------------- */
  const STORES = { workouts: 'id', sessions: 'id', rest: 'date', weights: 'date', tracks: 'id' };
  const DB = {
    db: null, memory: false, mem: {}, error: null,
    open() {
      return new Promise(resolve => {
        const fallback = e => { DB.memory = true; DB.error = e; Object.keys(STORES).forEach(s => { DB.mem[s] = new Map(); }); resolve(); };
        if (!window.indexedDB) return fallback(new Error('IndexedDB unavailable'));
        let req;
        try { req = window.indexedDB.open('vishesh-workout-studio', 1); } catch (e) { return fallback(e); }
        req.onupgradeneeded = () => {
          const db = req.result;
          Object.keys(STORES).forEach(s => { if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: STORES[s] }); });
        };
        req.onsuccess = () => { DB.db = req.result; DB.db.onversionchange = () => DB.db.close(); resolve(); };
        req.onerror = () => fallback(req.error);
        req.onblocked = () => fallback(new Error('IndexedDB blocked'));
      });
    },
    run(store, mode, fn) {
      return new Promise((res, rej) => {
        let t;
        try { t = DB.db.transaction(store, mode); } catch (e) { return rej(e); }
        let out;
        try { out = fn(t.objectStore(store)); } catch (e) { try { t.abort(); } catch (_) { /* ignore */ } return rej(e); }
        t.oncomplete = () => res(out && 'result' in out ? out.result : undefined);
        t.onerror = () => rej(t.error || new Error('Transaction failed'));
        t.onabort = () => rej(t.error || new Error('Transaction aborted'));
      });
    },
    getAll(store) { return DB.memory ? Promise.resolve(Array.from(DB.mem[store].values())) : DB.run(store, 'readonly', os => os.getAll()); },
    put(store, rec) {
      if (DB.memory) { DB.mem[store].set(rec[STORES[store]], rec); return Promise.resolve(); }
      return DB.run(store, 'readwrite', os => { os.put(rec); });
    },
    putMany(store, arr) {
      if (DB.memory) { arr.forEach(r => DB.mem[store].set(r[STORES[store]], r)); return Promise.resolve(); }
      return DB.run(store, 'readwrite', os => { arr.forEach(r => os.put(r)); });
    },
    del(store, key) {
      if (DB.memory) { DB.mem[store].delete(key); return Promise.resolve(); }
      return DB.run(store, 'readwrite', os => { os.delete(key); });
    },
    clear(store) {
      if (DB.memory) { DB.mem[store].clear(); return Promise.resolve(); }
      return DB.run(store, 'readwrite', os => { os.clear(); });
    }
  };
  async function persist(p) {
    try { await p; return true; } catch (e) {
      console.error(e);
      toast('Could not save to browser storage. Export a backup if you can.');
      return false;
    }
  }

  /* ---------------- state ---------------- */
  const S = { workouts: [], sessions: [], rest: [], weights: [], tracks: [] };
  const ui = { tab: 'home', catFilter: 'All', month: null, selDate: null, historyLimit: 20, seeking: false };
  const TABS = ['home', 'workouts', 'music', 'tracker', 'progress'];
  const restSet = () => new Set(S.rest.map(r => r.date));

  async function loadAll() {
    for (const s of Object.keys(STORES)) {
      try { S[s] = await DB.getAll(s); } catch (e) { console.error(e); S[s] = []; toast('Some saved data could not be read.'); }
    }
  }

  /* ---------------- toast & sheets ---------------- */
  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 3400);
  }
  let sheetResolve = null, sheetCleanup = null;
  function openSheet(html) {
    if (sheetCleanup) { sheetCleanup(); sheetCleanup = null; }
    if (sheetResolve) { const r = sheetResolve; sheetResolve = null; r(null); }
    $('#sheet-body').innerHTML = html;
    $('#sheet').hidden = false;
    $('.sheet-panel').scrollTop = 0;
  }
  function closeSheet() {
    if (sheetCleanup) { sheetCleanup(); sheetCleanup = null; }
    $('#sheet').hidden = true;
    $('#sheet-body').innerHTML = '';
    if (sheetResolve) { const r = sheetResolve; sheetResolve = null; r(null); }
  }
  function confirmSheet(o) {
    return new Promise(resolve => {
      openSheet('<h3 class="sheet-title">' + esc(o.title) + '</h3><p class="muted">' + o.text + '</p><div class="stack">' +
        o.buttons.map(b => '<button class="btn ' + (b.cls || 'btn-ghost') + ' btn-block" data-action="sheetChoice" data-value="' + esc(b.value) + '">' + esc(b.label) + '</button>').join('') + '</div>');
      sheetResolve = resolve;
    });
  }

  /* ---------------- formatting helpers ---------------- */
  const longDate = s => C.fromDateStr(s).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
  const shortDate = s => C.fromDateStr(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  const timeOfDay = ms => new Date(ms).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  const cleanName = n => String(n).replace(/\.[A-Za-z0-9]{2,5}$/, '');
  const fmtSize = b => b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';

  /* ---------------- navigation ---------------- */
  const NAV = [['home', 'Home', 'home'], ['workouts', 'Workouts', 'dumbbell'], ['music', 'Music', 'music'], ['tracker', 'Tracker', 'calendar'], ['progress', 'Progress', 'chart']];
  function buildNav() {
    $('#nav').innerHTML = NAV.map(n => '<button data-action="nav" data-tab="' + n[0] + '" aria-label="' + n[1] + '">' + icon(n[2], 24) + '<span>' + n[1] + '</span></button>').join('');
    $('#btn-settings').innerHTML = icon('sliders', 22);
  }
  function show(tab) {
    if (TABS.indexOf(tab) === -1) tab = 'home';
    ui.tab = tab;
    $$('.view').forEach(v => v.classList.toggle('active', v.dataset.view === tab));
    $$('#nav button').forEach(b => {
      const on = b.dataset.tab === tab;
      b.classList.toggle('active', on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    Prefs.set('tab', tab);
    rerender();
    window.scrollTo(0, 0);
  }
  function rerender() {
    ({ home: renderHome, workouts: renderWorkouts, music: renderMusic, tracker: renderTracker, progress: renderProgress })[ui.tab]();
    updatePlayerUI();
  }

  /* ================= HOME ================= */
  function barsHTML(items, cls) {
    const max = Math.max.apply(null, items.map(i => i.sec).concat([60]));
    return '<div class="bars ' + (cls || '') + '">' + items.map(i => {
      const h = i.sec > 0 ? Math.max(6, Math.round(i.sec / max * 100)) : 4;
      const m = Math.round(i.sec / 60);
      return '<div class="bar-col"><span class="bar-val">' + (i.sec > 0 ? m + 'm' : (i.rest ? 'rest' : '')) + '</span><div class="bar-track"><div class="bar ' + (i.sec > 0 ? 'has ' : '') + (i.today ? 'today' : '') +
        '" style="height:' + h + '%" title="' + esc(i.title || '') + '"></div></div><span class="bar-label ' + (i.today ? 'today' : '') + '">' + esc(i.label) + '</span></div>';
    }).join('') + '</div>';
  }

  function renderHome() {
    const today = todayStr(), by = C.totalsByDate(S.sessions), tod = by[today] || { sec: 0, count: 0 };
    const wk = C.weekTotals(by, today), rs = restSet();
    const st = C.computeStreaks(new Set(Object.keys(by)), rs, today);
    const goal = Prefs.get('goalMin', 30);
    const pct = Math.min(1, tod.sec / 60 / goal);
    const total = S.sessions.reduce((a, s) => a + s.activeSeconds, 0);
    const status = tod.count ? { t: 'Completed', c: 'ok' } : rs.has(today) ? { t: 'Rest day', c: 'rest' } : { t: 'Not done yet', c: 'todo' };
    const h = new Date().getHours();
    const greet = h < 5 ? 'Late night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
    const R = 54, CIRC = 2 * Math.PI * R;
    const todaySessions = S.sessions.filter(s => s.date === today).sort((a, b) => a.endedAt - b.endedAt);
    const next = S.workouts.slice().sort((a, b) => (b.lastUsedAt || 0) - (a.lastUsedAt || 0))[0];
    const labels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
    let cta;
    if (session) cta = '<button class="btn btn-primary btn-block" data-action="resumeSession">' + icon('play', 20) + ' Open running session</button>';
    else if (next) cta = '<button class="btn btn-primary btn-block" data-action="startWorkout" data-id="' + esc(next.id) + '">' + icon('play', 20) + ' Start: ' + esc(next.title) + '</button>';
    else cta = '<button class="btn btn-primary btn-block" data-action="addWorkout">' + icon('plus', 20) + ' Add your first workout</button>';

    $('#view-home').innerHTML =
      (DB.memory ? '<div class="banner"><b>Storage unavailable.</b> Your browser is blocking local storage, so data will be lost when you close this page. Export a backup before leaving (Settings, top right).</div>' : '') +
      (session ? '<div class="card live"><div><span class="dot"></span>Session in progress<br><b>' + esc(session.title) + '</b> · <span class="js-live-time">' + C.fmtClock(C.sessionElapsedMs(session, Date.now()) / 1000) + '</span></div><button class="btn btn-primary btn-sm" data-action="resumeSession">Open</button></div>' : '') +
      '<p class="eyebrow">' + greet + ', Vishesh</p><h1 class="page-title" style="margin:2px 0 14px">Today\'s Workout</h1>' +
      '<div class="card"><div class="hero"><div class="ring-wrap"><svg width="132" height="132" viewBox="0 0 132 132"><circle class="ring-bg" cx="66" cy="66" r="' + R + '" fill="none" stroke-width="12"/><circle class="ring-fg" cx="66" cy="66" r="' + R + '" fill="none" stroke-width="12" stroke-linecap="round" stroke-dasharray="' + CIRC.toFixed(1) + '" stroke-dashoffset="' + (CIRC * (1 - pct)).toFixed(1) + '"/></svg>' +
      '<div class="ring-center"><div><b>' + Math.round(tod.sec / 60) + '</b><br><span>of ' + goal + ' min</span></div></div></div>' +
      '<div class="stack" style="gap:8px"><span class="pill ' + status.c + '">' + (status.c === 'ok' ? icon('check', 14) : status.c === 'rest' ? icon('moon', 14) : '') + status.t + '</span>' +
      '<div><b>' + tod.count + '</b> <span class="muted">session' + (tod.count === 1 ? '' : 's') + ' today</span></div><div class="muted small">' + C.fmtMinutes(tod.sec) + ' active time</div></div></div>' +
      (todaySessions.length ? '<div class="today-list">' + todaySessions.map(s => '<div class="today-item"><span>' + esc(s.title) + '</span><b>' + C.fmtClock(s.activeSeconds) + '</b></div>').join('') + '</div>' : '') +
      '<div class="stack gap-top">' + cta +
      '<div class="grid2">' + (session ? '' : '<button class="btn btn-ghost" data-action="startFree">Free session</button>') +
      '<button class="btn btn-ghost" data-action="restToday"' + (tod.count ? ' disabled' : '') + '>' + icon('moon', 18) + (rs.has(today) ? ' Undo rest day' : ' Rest day') + '</button></div></div></div>' +
      '<div class="card"><div class="card-title">Streak</div><div class="streak"><span class="flame">' + icon('flame', 44) + '</span><div><b>' + st.current + '</b> <span class="muted">day' + (st.current === 1 ? '' : 's') + ' in a row</span><div class="muted small">Longest: ' + st.longest + ' day' + (st.longest === 1 ? '' : 's') + ' · rest days keep it alive</div></div></div></div>' +
      '<div class="card"><div class="card-title">This week</div>' +
      barsHTML(wk.days.map((d, i) => ({ sec: d.sec, label: labels[i], today: d.date === today, rest: rs.has(d.date) && !d.count, title: shortDate(d.date) + ': ' + C.fmtMinutes(d.sec) })), '') +
      '<div class="grid3 gap-top"><div class="stat"><b>' + wk.count + '</b><span>Workouts</span></div><div class="stat"><b>' + wk.active + '/7</b><span>Active days</span></div><div class="stat"><b>' + C.fmtMinutes(wk.sec) + '</b><span>Time</span></div></div></div>' +
      '<div class="card"><div class="card-title">Total workout duration</div><div class="grid3"><div class="stat"><b>' + C.fmtMinutes(tod.sec) + '</b><span>Today</span></div><div class="stat"><b>' + C.fmtMinutes(wk.sec) + '</b><span>This week</span></div><div class="stat"><b>' + C.fmtMinutes(total) + '</b><span>All time</span></div></div></div>';
  }

  /* ================= WORKOUT LIBRARY ================= */
  function renderWorkouts() {
    const cats = Array.from(new Set(S.workouts.map(w => w.category)));
    if (ui.catFilter !== 'All' && cats.indexOf(ui.catFilter) === -1) ui.catFilter = 'All';
    const list = S.workouts.filter(w => ui.catFilter === 'All' || w.category === ui.catFilter).sort((a, b) => b.createdAt - a.createdAt);
    const cards = list.map(w => {
      const p = C.parseYouTube(w.url);
      const thumb = p && C.thumbUrl(p);
      return '<div class="card wcard"><button class="thumb" data-action="previewWorkout" data-id="' + esc(w.id) + '" aria-label="Preview ' + esc(w.title) + '">' +
        (thumb ? '<img class="thumb-img" src="' + esc(thumb) + '" alt="" loading="lazy">' : '') +
        '<span class="play-badge"><span>' + icon('play', 26) + '</span></span></button>' +
        '<div class="wbody"><div class="wtitle">' + esc(w.title) + '</div><div class="row"><span class="tag">' + esc(w.category) + '</span><span class="muted small">' + (w.durationMin ? w.durationMin + ' min' : 'No duration') + '</span></div>' +
        '<div class="actions"><button class="btn btn-primary grow" data-action="startWorkout" data-id="' + esc(w.id) + '">' + icon('play', 18) + ' Start Workout</button>' +
        '<button class="btn btn-ghost btn-icon" data-action="editWorkout" data-id="' + esc(w.id) + '" aria-label="Edit">' + icon('edit', 20) + '</button>' +
        '<button class="btn btn-danger btn-icon" data-action="deleteWorkout" data-id="' + esc(w.id) + '" aria-label="Delete">' + icon('trash', 20) + '</button></div></div></div>';
    }).join('');
    $('#view-workouts').innerHTML =
      '<div class="page-head"><h1 class="page-title">Workouts</h1><button class="btn btn-primary btn-sm" data-action="addWorkout">' + icon('plus', 18) + ' Add</button></div>' +
      (session ? '<div class="card live"><div><span class="dot"></span>Session in progress<br><b>' + esc(session.title) + '</b></div><button class="btn btn-primary btn-sm" data-action="resumeSession">Open</button></div>' : '') +
      (cats.length > 1 ? '<div class="chips">' + ['All'].concat(cats).map(c => '<button class="chip ' + (c === ui.catFilter ? 'on' : '') + '" data-action="filterCat" data-cat="' + esc(c) + '">' + esc(c) + '</button>').join('') + '</div>' : '') +
      (S.workouts.length ? cards : '<div class="card empty"><h3>No workouts yet</h3><p>Paste any YouTube workout link, give it a title and category, and it will be saved here.</p><button class="btn btn-primary" data-action="addWorkout">' + icon('plus', 18) + ' Add a workout</button></div>') +
      (session ? '' : '<button class="btn btn-ghost btn-block" data-action="startFree">Start a free session (no video)</button>');
  }

  function workoutForm(w) {
    const cats = Array.from(new Set(C.DEFAULT_CATEGORIES.concat(S.workouts.map(x => x.category))));
    const cur = w ? w.category : cats[0];
    return '<h3 class="sheet-title">' + (w ? 'Edit workout' : 'Add workout') + '</h3>' +
      '<form data-form="workout" novalidate><input type="hidden" name="id" value="' + esc(w ? w.id : '') + '">' +
      '<div class="field"><label for="f-title">Title</label><input type="text" id="f-title" name="title" maxlength="120" required value="' + esc(w ? w.title : '') + '" placeholder="e.g. 20 min fat burn"></div>' +
      '<div class="field"><label for="f-url">YouTube link</label><input type="url" id="f-url" name="url" data-live="url" inputmode="url" autocapitalize="off" autocomplete="off" required value="' + esc(w ? w.url : '') + '" placeholder="https://youtube.com/watch?v=…"><div class="hint" id="url-hint"></div></div>' +
      '<div class="field"><label for="f-cat">Category</label><select id="f-cat" name="category" data-live="cat">' +
      cats.map(c => '<option value="' + esc(c) + '"' + (c === cur ? ' selected' : '') + '>' + esc(c) + '</option>').join('') + '<option value="__new">+ New category…</option></select></div>' +
      '<div class="field hidden" id="newcat-field"><label for="f-newcat">New category name</label><input type="text" id="f-newcat" name="newCategory" maxlength="40"></div>' +
      '<div class="field"><label for="f-dur">Duration (minutes)</label><input type="number" id="f-dur" name="duration" inputmode="numeric" min="1" max="600" required value="' + esc(w ? w.durationMin || '' : '') + '" placeholder="20"></div>' +
      '<div class="err" id="form-error" role="alert"></div>' +
      '<div class="stack"><button class="btn btn-primary btn-block" type="submit">Save workout</button><button class="btn btn-ghost btn-block" type="button" data-action="closeSheet">Cancel</button></div></form>';
  }
  async function saveWorkoutForm(form) {
    const f = new FormData(form), err = m => { $('#form-error').textContent = m; };
    const id = String(f.get('id') || ''), title = String(f.get('title') || '').trim(), url = String(f.get('url') || '').trim();
    let cat = String(f.get('category') || '');
    if (cat === '__new') cat = String(f.get('newCategory') || '').trim();
    const dur = parseInt(f.get('duration'), 10);
    if (!title) return err('Please enter a title.');
    if (!C.parseYouTube(url)) return err('That does not look like a YouTube video or playlist link.');
    if (!cat) return err('Please choose or enter a category.');
    if (!(dur >= 1 && dur <= 600)) return err('Duration must be between 1 and 600 minutes.');
    let w;
    if (id) {
      w = S.workouts.find(x => x.id === id);
      if (!w) return err('This workout no longer exists.');
      Object.assign(w, { title: title, url: url, category: cat.slice(0, 40), durationMin: dur });
    } else {
      w = { id: C.uid(), title: title, url: url, category: cat.slice(0, 40), durationMin: dur, createdAt: Date.now(), lastUsedAt: 0 };
      S.workouts.push(w);
    }
    closeSheet();
    rerender();
    if (await persist(DB.put('workouts', w))) toast(id ? 'Workout updated' : 'Workout saved');
  }

  /* ---------------- YouTube embedding with fallback ---------------- */
  let ytApiPromise = null;
  function loadYT() {
    if (window.YT && window.YT.Player) return Promise.resolve();
    if (ytApiPromise) return ytApiPromise;
    ytApiPromise = new Promise((res, rej) => {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { if (typeof prev === 'function') { try { prev(); } catch (e) { /* ignore */ } } res(); };
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api'; s.async = true;
      s.onerror = () => { ytApiPromise = null; rej(new Error('yt api blocked')); };
      document.head.appendChild(s);
      setTimeout(() => { if (!(window.YT && window.YT.Player)) { ytApiPromise = null; rej(new Error('yt api timeout')); } }, 8000);
    });
    return ytApiPromise;
  }
  /* Mounts a YouTube player into `box` and a fallback row into `fbBox`. Returns a destroy function.
   * With the YouTube IFrame API available, playback errors (e.g. embedding disabled) are detected and the
   * fallback is highlighted. If the API cannot load, a plain iframe is used and the "Open in YouTube"
   * button stays visible. */
  function mountVideo(box, fbBox, p) {
    let player = null, dead = false, failed = false, ready = false, timer = null;
    if (!p) { fbBox.innerHTML = '<div class="fallback alert">This workout has no valid YouTube link. Edit it to fix the link.</div>'; return function () {}; }
    const wUrl = C.watchUrl(p);
    fbBox.innerHTML = '<div class="fallback" id="fb-row"><span class="fb-msg">Video not playing? Open it in YouTube.</span><a class="btn btn-ghost btn-sm" href="' + esc(wUrl) + '" target="_blank" rel="noopener noreferrer">' + icon('external', 16) + ' Open in YouTube</a></div>';
    const fail = () => {
      if (failed || dead) return;
      failed = true;
      const row = $('#fb-row', fbBox);
      if (row) {
        row.classList.add('alert');
        row.innerHTML = '<span>This video can\'t be played inside the app (the owner may have blocked embedding, or it is unavailable). Watch it on YouTube instead.</span><a class="btn btn-primary btn-sm" href="' + esc(wUrl) + '" target="_blank" rel="noopener noreferrer">' + icon('external', 16) + ' Open in YouTube</a>';
      }
    };
    function plain() {
      box.innerHTML = '';
      const fr = document.createElement('iframe');
      fr.src = C.embedUrl(p);
      fr.title = 'Workout video';
      fr.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share');
      fr.setAttribute('allowfullscreen', '');
      fr.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
      box.appendChild(fr);
    }
    box.innerHTML = '<div class="player-loading">Loading video…</div>';
    loadYT().then(() => {
      if (dead) return;
      box.innerHTML = '';
      const mount = document.createElement('div');
      mount.id = 'yt-' + Math.random().toString(36).slice(2);
      box.appendChild(mount);
      const vars = { playsinline: 1, rel: 0, modestbranding: 1 };
      const opts = { host: 'https://www.youtube-nocookie.com', playerVars: vars, events: { onReady: () => { ready = true; }, onError: fail } };
      if (p.id) { opts.videoId = p.id; if (p.list) vars.list = p.list; } else { vars.listType = 'playlist'; vars.list = p.list; }
      try { player = new window.YT.Player(mount.id, opts); } catch (e) { plain(); return; }
      timer = setTimeout(() => { if (!ready) fail(); }, 12000);
    }).catch(() => { if (!dead) plain(); });
    return function destroy() {
      dead = true; clearTimeout(timer);
      try { if (player && player.destroy) player.destroy(); } catch (e) { /* ignore */ }
      box.innerHTML = '';
    };
  }
  function previewWorkout(id) {
    const w = S.workouts.find(x => x.id === id);
    if (!w) return;
    openSheet('<h3 class="sheet-title">' + esc(w.title) + '</h3><div class="player" id="pv-player"></div><div id="pv-fb"></div>' +
      '<div class="stack gap-top"><button class="btn btn-primary btn-block" data-action="startWorkout" data-id="' + esc(w.id) + '">' + icon('play', 18) + ' Start Workout</button><button class="btn btn-ghost btn-block" data-action="closeSheet">Close</button></div>');
    sheetCleanup = mountVideo($('#pv-player'), $('#pv-fb'), C.parseYouTube(w.url));
  }

  /* ================= WORKOUT SESSION ================= */
  let session = null, tickTimer = null, hbTimer = null, videoDestroy = null, wakeLock = null;
  const persistSession = () => { if (session) Prefs.set('active', session); else Prefs.remove('active'); };
  async function lockScreen() {
    try { if ('wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } } catch (e) { wakeLock = null; }
  }
  function unlockScreen() { try { if (wakeLock) wakeLock.release(); } catch (e) { /* ignore */ } wakeLock = null; }

  function startSession(w) {
    if (session) { toast('A session is already running'); openOverlay(); return; }
    session = C.newSession({ workoutId: w && w.id, title: w ? w.title : 'Free workout', category: w ? w.category : '' }, Date.now());
    persistSession();
    if (w) { w.lastUsedAt = Date.now(); persist(DB.put('workouts', w)); }
    closeSheet();
    openOverlay();
    lockScreen();
  }
  function openOverlay() {
    if (!session) return;
    const w = session.workoutId ? S.workouts.find(x => x.id === session.workoutId) : null;
    const p = w ? C.parseYouTube(w.url) : null;
    const el = $('#session');
    el.innerHTML = '<div class="session-inner"><div class="s-head"><div><p class="eyebrow">' + esc(session.category || 'Workout session') + '</p><h2>' + esc(session.title) + '</h2></div>' +
      '<button class="icon-btn" data-action="discardSession" aria-label="Discard session">' + icon('x', 22) + '</button></div>' +
      (p ? '<div class="player" id="s-player"></div><div id="s-fb"></div>' : '') +
      '<div class="timer" id="timer">00:00</div><div class="timer-state" id="timer-state">Active</div>' +
      '<div class="s-controls"><button class="btn btn-ghost" id="btn-pause" data-action="pauseToggle"></button><button class="btn btn-primary" data-action="finishSession">' + icon('check', 22) + ' Finish</button></div>' +
      '<div class="mini"><button class="ctrl" data-action="prevTrack" aria-label="Previous song">' + icon('prev', 20) + '</button><button class="ctrl js-play" data-action="togglePlay"></button><button class="ctrl" data-action="nextTrack" aria-label="Next song">' + icon('next', 20) + '</button><span class="js-np-title"></span></div>' +
      '<p class="muted small" style="margin-top:14px">The timer only counts active time. Paused time is not added to your workout.</p></div>';
    el.hidden = false;
    document.body.classList.add('lock');
    if (videoDestroy) videoDestroy();
    videoDestroy = p ? mountVideo($('#s-player'), $('#s-fb'), p) : null;
    updateTimer();
    clearInterval(tickTimer); clearInterval(hbTimer);
    tickTimer = setInterval(updateTimer, 250);
    hbTimer = setInterval(() => { if (session && session.resumedAt != null) { session.heartbeat = Date.now(); persistSession(); } }, 5000);
    updatePlayerUI();
  }
  function updateTimer() {
    if (!session) return;
    const running = session.resumedAt != null;
    const t = $('#timer');
    if (t) t.textContent = C.fmtClock(C.sessionElapsedMs(session, Date.now()) / 1000);
    const st = $('#timer-state');
    if (st) { st.textContent = running ? 'Active' : 'Paused — timer stopped'; st.classList.toggle('paused', !running); }
    const b = $('#btn-pause');
    if (b) { const label = running ? 'Pause' : 'Resume'; if (b.dataset.label !== label) { b.dataset.label = label; b.innerHTML = icon(running ? 'pause' : 'play', 20) + ' ' + label; } }
  }
  function pauseToggle() {
    if (!session) return;
    const now = Date.now();
    if (session.resumedAt != null) { session = C.pauseSession(session, now); unlockScreen(); } else { session = C.resumeSession(session, now); lockScreen(); }
    persistSession(); updateTimer();
  }
  function closeOverlay() {
    clearInterval(tickTimer); clearInterval(hbTimer);
    if (videoDestroy) { videoDestroy(); videoDestroy = null; }
    const el = $('#session'); el.hidden = true; el.innerHTML = '';
    document.body.classList.remove('lock');
    unlockScreen();
  }
  async function finishSession() {
    if (!session) return;
    session = C.pauseSession(session, Date.now());
    persistSession(); updateTimer();
    const sec = Math.round(session.accumMs / 1000);
    const buttons = sec >= 1 ? [{ label: 'Yes, I completed it', value: 'save', cls: 'btn-primary' }] : [];
    buttons.push({ label: 'Keep going', value: 'resume' }, { label: 'Discard this session', value: 'discard', cls: 'btn-danger' });
    const choice = await confirmSheet({
      title: 'Finish workout?',
      text: sec >= 1 ? 'Active time: <b>' + C.fmtClock(sec) + '</b>. Paused time is not counted. Confirm to save it to your history.' : 'No active time has been recorded yet.',
      buttons: buttons
    });
    if (choice === 'save') await saveSession(sec);
    else if (choice === 'resume') { session = C.resumeSession(session, Date.now()); persistSession(); lockScreen(); updateTimer(); }
    else if (choice === 'discard') endSession(false);
  }
  async function saveSession(sec) {
    const end = new Date();
    const rec = { id: C.uid(), workoutId: session.workoutId, title: session.title, category: session.category, date: C.toDateStr(end), startedAt: session.startedAt, endedAt: end.getTime(), activeSeconds: sec, completed: true };
    S.sessions.push(rec);
    const ri = S.rest.findIndex(r => r.date === rec.date);
    if (ri >= 0) { S.rest.splice(ri, 1); persist(DB.del('rest', rec.date)); }
    endSession(true);
    show('home');
    if (await persist(DB.put('sessions', rec))) toast('Workout saved · ' + C.fmtMinutes(sec));
  }
  function endSession() {
    session = null; persistSession(); closeOverlay();
    if (ui.tab) rerender();
  }
  async function discardSession() {
    if (!session) return;
    session = C.pauseSession(session, Date.now()); persistSession(); updateTimer();
    const c = await confirmSheet({ title: 'Discard session?', text: 'This session will not be saved to your history.', buttons: [{ label: 'Keep session', value: 'keep', cls: 'btn-primary' }, { label: 'Discard', value: 'discard', cls: 'btn-danger' }] });
    if (c === 'discard') endSession(false);
  }

  /* ================= MUSIC ================= */
  const Player = { audio: new Audio(), queue: [], qi: -1, currentId: null, files: new Map(), url: null, errStreak: 0, shuffle: Prefs.get('shuffle', false), repeat: Prefs.get('repeat', 'off') };
  const playable = t => !!(Player.files.get(t.id) || t.blob);
  const playlist = () => S.tracks.slice().sort((a, b) => a.order - b.order);
  const trackRecord = (t, withBlob) => { const r = { id: t.id, name: t.name, size: t.size, type: t.type, order: t.order, addedAt: t.addedAt }; if (withBlob && t.blob) r.blob = t.blob; return r; };

  function rebuildQueue() {
    const ids = playlist().filter(playable).map(t => t.id);
    Player.queue = C.buildQueue(ids, Player.currentId, Player.shuffle);
    Player.qi = Player.queue.indexOf(Player.currentId);
  }
  function setupAudio() {
    const a = Player.audio;
    a.preload = 'metadata';
    ['play', 'pause', 'timeupdate', 'loadedmetadata', 'durationchange'].forEach(ev => a.addEventListener(ev, updatePlayerUI));
    a.addEventListener('playing', () => { Player.errStreak = 0; updatePlayerUI(); });
    a.addEventListener('ended', () => { if (Player.repeat === 'one') { a.currentTime = 0; a.play().catch(() => {}); } else step(1, false); });
    a.addEventListener('error', () => {
      if (!Player.currentId) return;
      Player.errStreak++;
      if (Player.errStreak < Math.max(2, Player.queue.length)) { toast('Could not play that file — skipping'); step(1, true); } else { toast('Could not play these files'); a.pause(); }
    });
    if ('mediaSession' in navigator) {
      try {
        navigator.mediaSession.setActionHandler('play', () => togglePlay());
        navigator.mediaSession.setActionHandler('pause', () => a.pause());
        navigator.mediaSession.setActionHandler('previoustrack', () => step(-2, true));
        navigator.mediaSession.setActionHandler('nexttrack', () => step(1, true));
      } catch (e) { /* ignore */ }
    }
  }
  async function loadTrack(id, autoplay) {
    const t = S.tracks.find(x => x.id === id);
    if (!t) return;
    const src = Player.files.get(id) || t.blob;
    if (!src) { toast('Reselect this song file to play it'); return; }
    if (Player.url) { try { URL.revokeObjectURL(Player.url); } catch (e) { /* ignore */ } }
    try { Player.url = URL.createObjectURL(src); } catch (e) { toast('This browser cannot play local files'); return; }
    Player.audio.src = Player.url;
    Player.currentId = id;
    if (Player.queue.indexOf(id) === -1) rebuildQueue(); else Player.qi = Player.queue.indexOf(id);
    if ('mediaSession' in navigator && window.MediaMetadata) { try { navigator.mediaSession.metadata = new window.MediaMetadata({ title: cleanName(t.name), artist: 'Vishesh Workout Studio' }); } catch (e) { /* ignore */ } }
    if (ui.tab === 'music') renderMusic();
    updatePlayerUI();
    if (autoplay) { try { await Player.audio.play(); } catch (e) { if (e && e.name !== 'AbortError') toast('Tap play to start the song'); } }
  }
  function playTrack(id) { Player.currentId = id; rebuildQueue(); loadTrack(id, true); }
  function step(dir, manual) {
    if (!Player.queue.length) return;
    if (dir === -2) { // previous button: restart if past 3s, else go back
      if (Player.audio.currentTime > 3) { Player.audio.currentTime = 0; return; }
      dir = -1;
    }
    const wrap = manual || Player.repeat === 'all';
    const ni = C.stepQueue(Player.queue.length, Player.qi, dir, wrap);
    if (ni === -1) { Player.audio.pause(); Player.audio.currentTime = 0; updatePlayerUI(); return; }
    if (dir > 0 && ni <= Player.qi && Player.shuffle) { Player.queue = C.reshuffle(Player.queue, Player.currentId); Player.qi = 0; loadTrack(Player.queue[0], true); return; }
    Player.qi = ni;
    loadTrack(Player.queue[ni], true);
  }
  function togglePlay() {
    const a = Player.audio;
    if (!Player.currentId) {
      if (!Player.queue.length) rebuildQueue();
      if (!Player.queue.length) { toast('Add or reselect songs first'); return; }
      Player.qi = 0; loadTrack(Player.queue[0], true); return;
    }
    if (a.paused) a.play().catch(() => toast('Tap play again to start the song')); else a.pause();
  }
  function stopAndClear() {
    Player.audio.pause();
    Player.audio.removeAttribute('src');
    try { Player.audio.load(); } catch (e) { /* ignore */ }
    if (Player.url) { try { URL.revokeObjectURL(Player.url); } catch (e) { /* ignore */ } Player.url = null; }
    Player.currentId = null; Player.queue = []; Player.qi = -1;
  }
  function updatePlayerUI() {
    const a = Player.audio, t = S.tracks.find(x => x.id === Player.currentId);
    $$('.js-np-title').forEach(el => { el.textContent = t ? cleanName(t.name) : 'Nothing playing'; });
    const st = a.paused ? 'play' : 'pause';
    $$('.js-play').forEach(el => { if (el.dataset.st !== st) { el.dataset.st = st; el.innerHTML = icon(st, el.classList.contains('big') ? 32 : 24); el.setAttribute('aria-label', st === 'play' ? 'Play' : 'Pause'); } });
    const seek = $('#seek');
    if (seek && !ui.seeking) seek.value = a.duration && isFinite(a.duration) ? Math.round(a.currentTime / a.duration * 1000) : 0;
    const tm = $('#np-time');
    if (tm) tm.innerHTML = '<span>' + C.fmtClock(a.currentTime || 0) + '</span><span>' + (a.duration && isFinite(a.duration) ? C.fmtClock(a.duration) : '--:--') + '</span>';
  }
  async function addFiles(fileList) {
    const files = Array.from(fileList).filter(f => (f.type && f.type.indexOf('audio/') === 0) || /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|weba|amr|3gp)$/i.test(f.name));
    const ignored = fileList.length - files.length;
    if (!files.length) { toast('No audio files were selected'); return; }
    const keep = Prefs.get('keepFiles', true);
    if (keep && navigator.storage && navigator.storage.persist) { try { navigator.storage.persist(); } catch (e) { /* ignore */ } }
    let added = 0, relinked = 0, dup = 0, quota = false;
    let order = S.tracks.reduce((m, t) => Math.max(m, t.order || 0), 0);
    for (const f of files) {
      let t = S.tracks.find(x => x.name === f.name && x.size === f.size);
      if (t && playable(t)) { dup++; continue; }
      if (t) relinked++; else { t = { id: C.uid(), name: f.name, size: f.size, type: f.type || 'audio/mpeg', order: ++order, addedAt: Date.now() }; S.tracks.push(t); added++; }
      Player.files.set(t.id, f);
      let saved = false;
      if (keep) {
        try { await DB.put('tracks', Object.assign(trackRecord(t), { blob: f })); t.blob = f; saved = true; } catch (e) { quota = true; }
      }
      if (!saved) await persist(DB.put('tracks', trackRecord(t)));
    }
    rebuildQueue();
    rerender();
    const parts = [];
    if (added) parts.push(added + ' added');
    if (relinked) parts.push(relinked + ' reconnected');
    if (dup) parts.push(dup + ' already in playlist');
    if (ignored) parts.push(ignored + ' skipped (not audio)');
    toast(parts.join(' · ') || 'Nothing to add');
    if (quota) setTimeout(() => toast('Not enough browser storage to keep the song files. You will need to reselect them next visit.'), 3600);
  }
  async function removeTrack(id) {
    const wasCurrent = Player.currentId === id;
    S.tracks = S.tracks.filter(t => t.id !== id);
    Player.files.delete(id);
    if (wasCurrent) stopAndClear();
    rebuildQueue(); rerender();
    await persist(DB.del('tracks', id));
  }
  async function clearPlaylist() {
    const c = await confirmSheet({ title: 'Clear playlist?', text: 'This removes all songs from the app. Your original files on the phone are not touched.', buttons: [{ label: 'Clear playlist', value: 'yes', cls: 'btn-primary' }, { label: 'Cancel', value: 'no' }] });
    if (c !== 'yes') return;
    stopAndClear(); Player.files.clear(); S.tracks = [];
    rerender();
    await persist(DB.clear('tracks'));
  }
  function renderMusic() {
    const list = playlist(), missing = list.filter(t => !playable(t)).length, keep = Prefs.get('keepFiles', true);
    $('#view-music').innerHTML =
      '<div class="page-head"><h1 class="page-title">Music</h1></div>' +
      '<div class="banner info">Songs are played straight from your phone. Nothing is uploaded anywhere.</div>' +
      '<div class="card"><div class="card-title">Now playing</div><div class="np-title js-np-title">Nothing playing</div>' +
      '<input class="seek" type="range" id="seek" min="0" max="1000" step="1" value="0" aria-label="Seek"><div class="np-time" id="np-time"><span>00:00</span><span>--:--</span></div>' +
      '<div class="ctrls"><button class="ctrl ' + (Player.shuffle ? 'on' : '') + '" data-action="toggleShuffle" aria-label="Shuffle" aria-pressed="' + Player.shuffle + '">' + icon('shuffle', 22) + '</button>' +
      '<button class="ctrl" data-action="prevTrack" aria-label="Previous song">' + icon('prev', 22) + '</button>' +
      '<button class="ctrl big js-play" data-action="togglePlay"></button>' +
      '<button class="ctrl" data-action="nextTrack" aria-label="Next song">' + icon('next', 22) + '</button>' +
      '<button class="ctrl ' + (Player.repeat !== 'off' ? 'on' : '') + '" data-action="cycleRepeat" aria-label="Repeat: ' + Player.repeat + '">' + icon('repeat', 22) + (Player.repeat === 'one' ? '<span class="one">1</span>' : '') + '</button></div>' +
      '<p class="muted small" style="margin-top:10px;text-align:center">Shuffle: ' + (Player.shuffle ? 'on' : 'off') + ' · Repeat: ' + (Player.repeat === 'off' ? 'off' : Player.repeat === 'all' ? 'all songs' : 'this song') + '</p></div>' +
      '<div class="card"><button class="btn btn-primary btn-block" data-action="pickFiles">' + icon('plus', 20) + ' Add / reselect songs</button>' +
      '<label class="checkrow"><input type="checkbox" id="keepFiles" ' + (keep ? 'checked' : '') + '><span>Keep a copy of the songs inside this browser so they are ready next time. Uses phone storage and stays on this device only.</span></label>' +
      (missing ? '<div class="banner" style="margin:6px 0 0"><b>' + missing + ' song' + (missing === 1 ? ' needs' : 's need') + ' to be reselected.</b> Browsers cannot remember files from your phone by themselves. Tap “Add / reselect songs” and choose the same files again; they are matched by name and size.</div>' : '') + '</div>' +
      '<div class="card"><div class="row between"><div class="card-title" style="margin:0">Playlist (' + list.length + ')</div>' + (list.length ? '<button class="btn btn-ghost btn-sm" data-action="clearPlaylist">Clear</button>' : '') + '</div>' +
      (list.length ? list.map(t => '<div class="track ' + (t.id === Player.currentId ? 'cur' : '') + (playable(t) ? '' : ' off') + '"><button class="track-main" data-action="playTrack" data-id="' + esc(t.id) + '"><span class="track-name">' + esc(cleanName(t.name)) + '</span><small>' + fmtSize(t.size) + (playable(t) ? '' : ' · reselect file to play') + '</small></button>' +
        '<button class="btn btn-ghost btn-icon" data-action="removeTrack" data-id="' + esc(t.id) + '" aria-label="Remove song">' + icon('x', 18) + '</button></div>').join('') : '<p class="muted" style="margin-top:12px">No songs yet. Tap “Add / reselect songs” to pick music from your phone.</p>') + '</div>';
  }

  /* ================= TRACKER ================= */
  function renderTracker() {
    const today = todayStr();
    if (!ui.month) { const d = new Date(); ui.month = { y: d.getFullYear(), m: d.getMonth() }; }
    if (!ui.selDate) ui.selDate = today;
    const y = ui.month.y, m = ui.month.m, by = C.totalsByDate(S.sessions), rs = restSet();
    const st = C.computeStreaks(new Set(Object.keys(by)), rs, today);
    const wk = C.weekTotals(by, today), tod = by[today] || { sec: 0, count: 0 };
    const nowD = new Date(), atCurrent = y > nowD.getFullYear() || (y === nowD.getFullYear() && m >= nowD.getMonth());
    const cells = C.monthMatrix(y, m).map(row => row.map(d => {
      if (!d) return '<button class="day blank" tabindex="-1" aria-hidden="true"></button>';
      const cls = ['day']; if (by[d]) cls.push('done'); else if (rs.has(d)) cls.push('rest'); if (d === today) cls.push('today'); if (d === ui.selDate) cls.push('sel'); if (d > today) cls.push('future');
      return '<button class="' + cls.join(' ') + '" data-action="selDay" data-date="' + d + '" aria-label="' + esc(longDate(d)) + (by[d] ? ', workout done' : rs.has(d) ? ', rest day' : '') + '">' + parseInt(d.slice(8), 10) + '</button>';
    }).join('')).join('');
    const sel = ui.selDate, selBy = by[sel] || { sec: 0, count: 0 };
    const selSessions = S.sessions.filter(s => s.date === sel).sort((a, b) => a.endedAt - b.endedAt);
    const restBtn = selBy.count ? '' : '<button class="btn btn-ghost btn-block gap-top" data-action="toggleRest" data-date="' + sel + '"' + (sel > today ? ' disabled' : '') + '>' + icon('moon', 18) + (rs.has(sel) ? ' Remove rest day' : ' Mark as rest day') + '</button>';
    $('#view-tracker').innerHTML =
      '<div class="page-head"><h1 class="page-title">Tracker</h1></div>' +
      '<div class="grid2"><div class="card"><div class="card-title">Current streak</div><div class="streak"><span class="flame">' + icon('flame', 30) + '</span><b>' + st.current + '</b></div></div>' +
      '<div class="card"><div class="card-title">Longest streak</div><div class="streak"><span class="flame">' + icon('flame', 30) + '</span><b>' + st.longest + '</b></div></div></div>' +
      '<div class="card"><div class="cal-head"><button class="btn btn-ghost btn-icon" data-action="prevMonth" aria-label="Previous month">' + icon('left', 22) + '</button><div class="cal-title">' + new Date(y, m, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }) + '</div>' +
      '<button class="btn btn-ghost btn-icon" data-action="nextMonth" aria-label="Next month"' + (atCurrent ? ' disabled' : '') + '>' + icon('right', 22) + '</button></div>' +
      '<div class="cal">' + ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map(l => '<div class="dow">' + l + '</div>').join('') + cells + '</div>' +
      '<div class="legend"><span><i style="background:var(--red)"></i>Workout</span><span><i style="background:#3a4258"></i>Rest day</span><span><i style="box-shadow:0 0 0 2px #fff inset"></i>Today</span></div></div>' +
      '<div class="card"><div class="card-title">' + esc(longDate(sel)) + '</div>' +
      (selSessions.length ? selSessions.map(s => '<div class="hist-item"><div class="hist-main"><b>' + esc(s.title) + '</b><span class="muted small">' + (s.endedAt ? timeOfDay(s.endedAt) : '') + '</span></div><b>' + C.fmtClock(s.activeSeconds) + '</b></div>').join('') +
        '<div class="row between gap-top"><span class="muted">Day total</span><b>' + C.fmtMinutes(selBy.sec) + '</b></div>' : '<p class="muted">' + (rs.has(sel) ? 'Rest day. Streak protected.' : sel > today ? 'This day is in the future.' : 'No workout recorded.') + '</p>') + restBtn + '</div>' +
      '<div class="card"><div class="card-title">Totals</div><div class="grid2"><div class="stat"><b>' + C.fmtMinutes(tod.sec) + '</b><span>Today · ' + tod.count + ' session' + (tod.count === 1 ? '' : 's') + '</span></div>' +
      '<div class="stat"><b>' + C.fmtMinutes(wk.sec) + '</b><span>This week · ' + wk.count + ' session' + (wk.count === 1 ? '' : 's') + '</span></div></div></div>';
  }
  async function toggleRest(date) {
    if (date > todayStr()) { toast('You can\'t mark a future day'); return; }
    if (C.totalsByDate(S.sessions)[date]) { toast('You trained that day — no rest mark needed'); return; }
    const i = S.rest.findIndex(r => r.date === date);
    if (i >= 0) { S.rest.splice(i, 1); rerender(); if (await persist(DB.del('rest', date))) toast('Rest day removed'); }
    else { const rec = { date: date, markedAt: Date.now() }; S.rest.push(rec); rerender(); if (await persist(DB.put('rest', rec))) toast('Rest day marked. Your streak is safe.'); }
  }

  /* ================= PROGRESS ================= */
  function lineChart(points) {
    const W = 320, H = 160, pl = 36, pr = 12, pt = 12, pb = 24;
    const vals = points.map(p => p.kg);
    let min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
    if (max - min < 1) { min -= 0.5; max += 0.5; }
    const padv = (max - min) * 0.15; min -= padv; max += padv;
    const x = i => points.length === 1 ? W / 2 : pl + (W - pl - pr) * i / (points.length - 1);
    const y = v => pt + (H - pt - pb) * (1 - (v - min) / (max - min));
    let g = '';
    for (let i = 0; i < 3; i++) { const v = min + (max - min) * i / 2, yy = y(v); g += '<line class="grid" x1="' + pl + '" x2="' + (W - pr) + '" y1="' + yy.toFixed(1) + '" y2="' + yy.toFixed(1) + '"/><text x="' + (pl - 6) + '" y="' + (yy + 3).toFixed(1) + '" text-anchor="end">' + v.toFixed(1) + '</text>'; }
    const pts = points.map((p, i) => x(i).toFixed(1) + ',' + y(p.kg).toFixed(1)).join(' ');
    return '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Body weight chart">' + g +
      (points.length > 1 ? '<polyline class="line" points="' + pts + '"/>' : '') +
      points.map((p, i) => '<circle class="pt" cx="' + x(i).toFixed(1) + '" cy="' + y(p.kg).toFixed(1) + '" r="3.5"/>').join('') +
      '<text x="' + pl + '" y="' + (H - 6) + '">' + esc(shortDate(points[0].date)) + '</text>' +
      (points.length > 1 ? '<text x="' + (W - pr) + '" y="' + (H - 6) + '" text-anchor="end">' + esc(shortDate(points[points.length - 1].date)) + '</text>' : '') + '</svg>';
  }
  function renderProgress() {
    const today = todayStr(), by = C.totalsByDate(S.sessions);
    const weights = S.weights.slice().sort((a, b) => a.date < b.date ? -1 : 1), last30 = weights.slice(-30);
    const weeks = C.recentWeeks(by, today, 8);
    const total = S.sessions.reduce((a, s) => a + s.activeSeconds, 0);
    const activeWeeks = new Set(S.sessions.map(s => C.startOfWeek(s.date))).size;
    const allWeekTotals = {}; S.sessions.forEach(s => { const k = C.startOfWeek(s.date); allWeekTotals[k] = (allWeekTotals[k] || 0) + s.activeSeconds; });
    const best = Math.max.apply(null, Object.keys(allWeekTotals).map(k => allWeekTotals[k]).concat([0]));
    const hist = S.sessions.slice().sort((a, b) => (b.endedAt || 0) - (a.endedAt || 0) || (a.date < b.date ? 1 : -1));
    const latest = weights[weights.length - 1], first = weights[0];
    const diff = latest && first && weights.length > 1 ? latest.kg - first.kg : null;
    $('#view-progress').innerHTML =
      '<div class="page-head"><h1 class="page-title">Progress</h1></div>' +
      '<div class="card"><div class="card-title">Body weight</div>' +
      '<form data-form="weight" class="wform" novalidate><div class="field"><label for="w-date">Date</label><input type="date" id="w-date" name="date" max="' + today + '" value="' + today + '" required></div>' +
      '<div class="field"><label for="w-kg">Weight (kg)</label><input type="number" id="w-kg" name="kg" step="0.1" min="10" max="700" inputmode="decimal" required placeholder="65.0"></div>' +
      '<button class="btn btn-primary" type="submit">' + icon('check', 20) + ' Save weight</button></form><div class="err" id="weight-error" role="alert" style="margin-top:10px"></div>' +
      (last30.length ? '<div class="gap-top">' + lineChart(last30) + '</div>' : '<p class="muted small">Log your weight to see a chart.</p>') +
      (latest ? '<div class="grid2 gap-top"><div class="stat"><b>' + latest.kg.toFixed(1) + ' kg</b><span>Latest · ' + esc(shortDate(latest.date)) + '</span></div><div class="stat"><b>' + (diff === null ? '—' : (diff > 0 ? '+' : '') + diff.toFixed(1) + ' kg') + '</b><span>Since first entry</span></div></div>' : '') +
      (weights.length ? '<div class="gap-top">' + weights.slice().reverse().slice(0, 6).map(w => '<div class="hist-item"><div class="hist-main"><b>' + w.kg.toFixed(1) + ' kg</b><span class="muted small">' + esc(shortDate(w.date)) + '</span></div><button class="btn btn-ghost btn-icon" data-action="deleteWeight" data-date="' + w.date + '" aria-label="Delete entry">' + icon('trash', 18) + '</button></div>').join('') + '</div>' : '') + '</div>' +
      '<div class="card"><div class="card-title">Weekly activity · last 8 weeks</div>' +
      barsHTML(weeks.map(w => ({ sec: w.sec, label: shortDate(w.weekStart), today: w.weekStart === C.startOfWeek(today), title: w.count + ' workouts' })), 'tall') +
      '<div class="grid2 gap-top"><div class="stat"><b>' + S.sessions.length + '</b><span>Total workouts</span></div><div class="stat"><b>' + C.fmtMinutes(total) + '</b><span>Total time</span></div>' +
      '<div class="stat"><b>' + (activeWeeks ? C.fmtMinutes(total / activeWeeks) : '0 min') + '</b><span>Avg per active week</span></div><div class="stat"><b>' + C.fmtMinutes(best) + '</b><span>Best week</span></div></div></div>' +
      '<div class="card"><div class="card-title">Workout history</div>' +
      (hist.length ? hist.slice(0, ui.historyLimit).map(s => '<div class="hist-item"><div class="hist-main"><b>' + esc(s.title) + '</b><span class="muted small">' + esc(shortDate(s.date)) + (s.endedAt ? ' · ' + timeOfDay(s.endedAt) : '') + '</span></div><b>' + C.fmtClock(s.activeSeconds) + '</b><button class="btn btn-ghost btn-icon" data-action="deleteSession" data-id="' + esc(s.id) + '" aria-label="Delete session">' + icon('trash', 18) + '</button></div>').join('') +
        (hist.length > ui.historyLimit ? '<button class="btn btn-ghost btn-block gap-top" data-action="moreHistory">Show more</button>' : '') : '<p class="muted">Finished workouts will appear here.</p>') + '</div>';
  }
  async function saveWeight(form) {
    const f = new FormData(form), date = String(f.get('date') || ''), kg = parseFloat(f.get('kg')), err = m => { $('#weight-error').textContent = m; };
    if (!C.isDateStr(date) || date > todayStr()) return err('Pick a valid date (not in the future).');
    if (!(kg >= 10 && kg <= 700)) return err('Enter a weight between 10 and 700 kg.');
    const rec = { date: date, kg: Math.round(kg * 10) / 10 };
    const i = S.weights.findIndex(w => w.date === date);
    if (i >= 0) S.weights[i] = rec; else S.weights.push(rec);
    rerender();
    if (await persist(DB.put('weights', rec))) toast('Weight saved');
  }

  /* ================= SETTINGS, BACKUP, PRIVACY ================= */
  function openSettings() {
    const last = Prefs.get('lastBackup', null);
    openSheet('<h3 class="sheet-title">Settings &amp; backup</h3>' +
      '<form data-form="settings" novalidate><div class="field"><label for="s-goal">Daily goal (minutes)</label><input type="number" id="s-goal" name="goal" min="5" max="600" inputmode="numeric" value="' + Prefs.get('goalMin', 30) + '"></div><button class="btn btn-ghost btn-block" type="submit">Save goal</button></form><hr>' +
      '<div class="card-title">Backup</div><div class="stack"><button class="btn btn-primary btn-block" data-action="exportData">' + icon('download', 20) + ' Export backup (JSON)</button><button class="btn btn-ghost btn-block" data-action="importData">' + icon('upload', 20) + ' Import backup</button></div>' +
      '<p class="muted small" style="margin-top:10px">' + (last ? 'Last backup: ' + esc(new Date(last).toLocaleString('en-IN')) : 'You have not made a backup yet.') + ' Music files are not included in backups, only the playlist names.</p><hr>' +
      '<div class="card-title">Privacy &amp; storage</div>' +
      '<p class="muted small">Everything stays on this device. Nothing is uploaded and there are no accounts or API keys. Your data lives in this browser\'s storage and can be erased if you clear site data, uninstall the browser, run a storage cleaner, or use private mode. It is not a guaranteed backup, so export regularly.</p>' +
      '<p class="muted small" id="storage-info">Checking storage…</p><button class="btn btn-ghost btn-block" data-action="requestPersist">Ask browser to protect my data</button><hr>' +
      '<button class="btn btn-danger btn-block" data-action="clearAll">Delete all app data</button><button class="btn btn-ghost btn-block gap-top" data-action="closeSheet">Close</button>');
    storageInfo();
  }
  async function storageInfo() {
    const el = $('#storage-info'); if (!el) return;
    const lines = [];
    lines.push(DB.memory ? 'Browser storage is unavailable here. Data will be lost when you close the page.' : 'Browser storage is working.');
    try {
      if (navigator.storage && navigator.storage.estimate) { const e = await navigator.storage.estimate(); lines.push('Using ' + fmtSize(e.usage || 0) + (e.quota ? ' of about ' + fmtSize(e.quota) + ' available.' : '.')); }
      if (navigator.storage && navigator.storage.persisted) lines.push((await navigator.storage.persisted()) ? 'Protected storage: granted.' : 'Protected storage: not granted (the browser may clear data when space is low).');
    } catch (e) { /* ignore */ }
    const el2 = $('#storage-info'); if (el2) el2.textContent = lines.join(' ');
  }
  function exportData() {
    try {
      const payload = { app: 'vishesh-workout-studio', version: 1, exportedAt: new Date().toISOString(), prefs: { dailyGoalMin: Prefs.get('goalMin', 30) },
        workouts: S.workouts, sessions: S.sessions, rest: S.rest, weights: S.weights, tracks: S.tracks.map(t => trackRecord(t, false)) };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = url; a.download = 'vishesh-workout-backup-' + todayStr() + '.json';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 15000);
      Prefs.set('lastBackup', new Date().toISOString());
      toast('Backup downloaded. Keep the file somewhere safe.');
    } catch (e) { console.error(e); toast('Could not create the backup file in this browser.'); }
  }
  async function handleImportFile(file) {
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) { toast('That file is too large to be a backup.'); return; }
    let obj;
    try { obj = JSON.parse(await file.text()); } catch (e) { toast('That file is not valid JSON.'); return; }
    const r = C.sanitizeImport(obj);
    if (!r.ok) { toast(r.error); return; }
    const d = r.data;
    const c = await confirmSheet({
      title: 'Import backup?',
      text: 'Found <b>' + d.workouts.length + '</b> workouts, <b>' + d.sessions.length + '</b> sessions, <b>' + d.rest.length + '</b> rest days, <b>' + d.weights.length + '</b> weight entries' + (r.skipped ? ' (' + r.skipped + ' invalid items skipped)' : '') + '.<br><br><b>Merge</b> adds them to what you have (same items are overwritten). <b>Replace</b> wipes your current workouts, history, rest days and weights first.',
      buttons: [{ label: 'Merge with current data', value: 'merge', cls: 'btn-primary' }, { label: 'Replace current data', value: 'replace', cls: 'btn-danger' }, { label: 'Cancel', value: 'cancel' }]
    });
    if (c !== 'merge' && c !== 'replace') return;
    try {
      if (c === 'replace') for (const s of ['workouts', 'sessions', 'rest', 'weights']) await DB.clear(s);
      for (const s of ['workouts', 'sessions', 'rest', 'weights']) if (d[s].length) await DB.putMany(s, d[s]);
      const known = new Set(S.tracks.map(t => t.id));
      const newTracks = d.tracks.filter(t => !known.has(t.id));
      if (newTracks.length) await DB.putMany('tracks', newTracks);
      if (d.goalMin) Prefs.set('goalMin', d.goalMin);
      await loadAll();
      rebuildQueue(); rerender();
      toast('Backup imported');
    } catch (e) { console.error(e); toast('Import failed. Your existing data was not fully changed.'); await loadAll(); rerender(); }
  }
  async function clearAll() {
    const c = await confirmSheet({ title: 'Delete all data?', text: 'This permanently erases workouts, history, rest days, weights, playlist and settings from this browser. Export a backup first if you might want it.', buttons: [{ label: 'Delete everything', value: 'yes', cls: 'btn-primary' }, { label: 'Cancel', value: 'no' }] });
    if (c !== 'yes') return;
    try { for (const s of Object.keys(STORES)) await DB.clear(s); } catch (e) { console.error(e); }
    stopAndClear(); Player.files.clear();
    if (session) { session = null; closeOverlay(); }
    Prefs.clearAll();
    Object.keys(S).forEach(k => { S[k] = []; });
    Player.shuffle = false; Player.repeat = 'off';
    show('home'); toast('All app data deleted');
  }

  /* ================= EVENTS ================= */
  const actions = {
    nav: d => show(d.tab),
    openSettings: openSettings,
    closeSheet: closeSheet,
    sheetChoice: d => { const r = sheetResolve; sheetResolve = null; closeSheet(); if (r) r(d.value); },
    addWorkout: () => openSheet(workoutForm(null)),
    editWorkout: d => { const w = S.workouts.find(x => x.id === d.id); if (w) openSheet(workoutForm(w)); },
    deleteWorkout: async d => {
      const w = S.workouts.find(x => x.id === d.id); if (!w) return;
      const c = await confirmSheet({ title: 'Delete workout?', text: '“' + esc(w.title) + '” will be removed from your library. Your workout history stays.', buttons: [{ label: 'Delete', value: 'yes', cls: 'btn-primary' }, { label: 'Cancel', value: 'no' }] });
      if (c !== 'yes') return;
      S.workouts = S.workouts.filter(x => x.id !== d.id); rerender();
      if (await persist(DB.del('workouts', d.id))) toast('Workout deleted');
    },
    previewWorkout: d => previewWorkout(d.id),
    startWorkout: d => { const w = S.workouts.find(x => x.id === d.id); if (w) startSession(w); },
    startFree: () => startSession(null),
    resumeSession: openOverlay,
    pauseToggle: pauseToggle,
    finishSession: finishSession,
    discardSession: discardSession,
    filterCat: d => { ui.catFilter = d.cat; renderWorkouts(); },
    restToday: () => toggleRest(todayStr()),
    prevMonth: () => { ui.month.m--; if (ui.month.m < 0) { ui.month.m = 11; ui.month.y--; } renderTracker(); },
    nextMonth: () => { ui.month.m++; if (ui.month.m > 11) { ui.month.m = 0; ui.month.y++; } renderTracker(); },
    selDay: d => { ui.selDate = d.date; renderTracker(); },
    toggleRest: d => toggleRest(d.date),
    deleteWeight: async d => {
      const c = await confirmSheet({ title: 'Delete weight entry?', text: 'Remove the entry for ' + esc(shortDate(d.date)) + '?', buttons: [{ label: 'Delete', value: 'yes', cls: 'btn-primary' }, { label: 'Cancel', value: 'no' }] });
      if (c !== 'yes') return;
      S.weights = S.weights.filter(w => w.date !== d.date); rerender(); await persist(DB.del('weights', d.date));
    },
    deleteSession: async d => {
      const s = S.sessions.find(x => x.id === d.id); if (!s) return;
      const c = await confirmSheet({ title: 'Delete this session?', text: '“' + esc(s.title) + '” on ' + esc(shortDate(s.date)) + ' (' + C.fmtClock(s.activeSeconds) + ') will be removed from your history and totals.', buttons: [{ label: 'Delete', value: 'yes', cls: 'btn-primary' }, { label: 'Cancel', value: 'no' }] });
      if (c !== 'yes') return;
      S.sessions = S.sessions.filter(x => x.id !== d.id); rerender(); await persist(DB.del('sessions', d.id));
    },
    moreHistory: () => { ui.historyLimit += 20; renderProgress(); },
    pickFiles: () => $('#audio-input').click(),
    playTrack: d => playTrack(d.id),
    togglePlay: togglePlay,
    nextTrack: () => step(1, true),
    prevTrack: () => step(-2, true),
    toggleShuffle: () => { Player.shuffle = !Player.shuffle; Prefs.set('shuffle', Player.shuffle); rebuildQueue(); renderMusic(); updatePlayerUI(); },
    cycleRepeat: () => { Player.repeat = Player.repeat === 'off' ? 'all' : Player.repeat === 'all' ? 'one' : 'off'; Prefs.set('repeat', Player.repeat); renderMusic(); updatePlayerUI(); },
    removeTrack: d => removeTrack(d.id),
    clearPlaylist: clearPlaylist,
    exportData: exportData,
    importData: () => $('#import-input').click(),
    requestPersist: async () => {
      try { const ok = navigator.storage && navigator.storage.persist ? await navigator.storage.persist() : false; toast(ok ? 'Browser agreed to protect your data' : 'The browser did not grant protected storage'); } catch (e) { toast('Not supported in this browser'); }
      storageInfo();
    },
    clearAll: clearAll
  };
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-action]');
    if (!el || el.disabled) return;
    const fn = actions[el.dataset.action];
    if (fn) { e.preventDefault(); fn(el.dataset, el); }
  });
  document.addEventListener('submit', e => {
    const f = e.target.closest('form[data-form]');
    if (!f) return;
    e.preventDefault();
    if (f.dataset.form === 'workout') saveWorkoutForm(f);
    else if (f.dataset.form === 'weight') saveWeight(f);
    else if (f.dataset.form === 'settings') {
      const g = parseInt(new FormData(f).get('goal'), 10);
      if (!(g >= 5 && g <= 600)) { toast('Goal must be 5–600 minutes'); return; }
      Prefs.set('goalMin', g); toast('Goal saved'); rerender();
    }
  });
  document.addEventListener('input', e => {
    const t = e.target;
    if (t.id === 'seek') { ui.seeking = true; const a = Player.audio; if (a.duration && isFinite(a.duration)) a.currentTime = t.value / 1000 * a.duration; }
    else if (t.dataset && t.dataset.live === 'url') {
      const h = $('#url-hint'); if (!h) return;
      if (!t.value.trim()) { h.textContent = ''; h.className = 'hint'; return; }
      const p = C.parseYouTube(t.value);
      h.textContent = p ? (p.type === 'playlist' ? 'Playlist link detected' : 'YouTube video detected') : 'Not a valid YouTube link yet';
      h.className = 'hint ' + (p ? 'ok' : 'bad');
    }
  });
  document.addEventListener('change', e => {
    const t = e.target;
    if (t.id === 'seek') ui.seeking = false;
    else if (t.id === 'keepFiles') Prefs.set('keepFiles', t.checked);
    else if (t.id === 'audio-input') { const files = Array.from(t.files || []); t.value = ''; if (files.length) addFiles(files); }
    else if (t.id === 'import-input') { const f = t.files && t.files[0]; t.value = ''; handleImportFile(f); }
    else if (t.dataset && t.dataset.live === 'cat') { const nf = $('#newcat-field'); if (nf) nf.classList.toggle('hidden', t.value !== '__new'); }
  });
  document.addEventListener('pointerup', () => { ui.seeking = false; });
  document.addEventListener('error', e => { if (e.target && e.target.tagName === 'IMG') e.target.classList.add('broken'); }, true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#sheet').hidden) closeSheet(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      if (session && session.resumedAt != null) lockScreen();
      if (session) updateTimer();
      if (ui.tab === 'home') $$('.js-live-time').forEach(el => { if (session) el.textContent = C.fmtClock(C.sessionElapsedMs(session, Date.now()) / 1000); });
    }
  });
  window.addEventListener('pagehide', () => { if (session && session.resumedAt != null) { session.heartbeat = Date.now(); persistSession(); } });

  /* ================= BOOT ================= */
  async function boot() {
    buildNav();
    await DB.open();
    await loadAll();
    const restored = C.restoreSession(Prefs.get('active', null), Date.now(), 120000);
    if (restored) { session = restored; persistSession(); } else Prefs.remove('active');
    setupAudio();
    rebuildQueue();
    $('#loading').remove();
    show(Prefs.get('tab', 'home'));
    if (session) {
      openOverlay();
      if (session.restoredPaused) { toast('Session restored. The timer was paused; tap Resume when you continue.'); delete session.restoredPaused; persistSession(); }
    }
    if (DB.memory) toast('Browser storage is unavailable, so data will not be saved.');
  }
  boot().catch(e => {
    console.error(e);
    const l = $('#loading'); if (l) l.textContent = 'Something went wrong while starting the app. Try reloading the page.';
  });
})();
