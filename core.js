/* core.js — Vishesh Workout Studio
 * Pure logic (no DOM, no storage). Runs in the browser as window.Core and in Node for tests.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Core = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEFAULT_CATEGORIES = [
    'Fat Burning', 'Morning Workout', 'Full Body', 'Dumbbell Workout',
    'Cardio', 'Strength', 'Stretching'
  ];

  /* ---------------- ids & formatting ---------------- */
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
  const pad = n => String(n).padStart(2, '0');

  function fmtClock(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return h ? h + ':' + pad(m) + ':' + pad(s) : pad(m) + ':' + pad(s);
  }
  function fmtMinutes(sec) {
    sec = Math.max(0, Math.round(sec || 0));
    if (sec === 0) return '0 min';
    const m = Math.round(sec / 60);
    if (m === 0) return '<1 min';
    if (m < 60) return m + ' min';
    return Math.floor(m / 60) + 'h ' + pad(m % 60) + 'm';
  }

  /* ---------------- dates (local time, 'YYYY-MM-DD') ---------------- */
  function toDateStr(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function fromDateStr(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s));
    if (!m) return null;
    const d = new Date(+m[1], +m[2] - 1, +m[3], 12, 0, 0);
    return (d.getFullYear() === +m[1] && d.getMonth() === +m[2] - 1 && d.getDate() === +m[3]) ? d : null;
  }
  function isDateStr(s) { return typeof s === 'string' && fromDateStr(s) !== null; }
  function addDays(s, n) {
    const d = fromDateStr(s);
    d.setDate(d.getDate() + n);
    return toDateStr(d);
  }
  function startOfWeek(s) { // Monday
    const d = fromDateStr(s);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return toDateStr(d);
  }
  function weekDates(s) {
    const st = startOfWeek(s);
    return Array.from({ length: 7 }, (_, i) => addDays(st, i));
  }
  function monthMatrix(year, month0) {
    const lead = (new Date(year, month0, 1, 12).getDay() + 6) % 7;
    const dim = new Date(year, month0 + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < lead; i++) cells.push(null);
    for (let d = 1; d <= dim; d++) cells.push(year + '-' + pad(month0 + 1) + '-' + pad(d));
    while (cells.length % 7) cells.push(null);
    const rows = [];
    for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
    return rows;
  }

  /* ---------------- YouTube ---------------- */
  const ID_RE = /^[A-Za-z0-9_-]{11}$/;
  const LIST_RE = /^[A-Za-z0-9_-]{10,64}$/;

  function parseYouTube(input) {
    if (typeof input !== 'string') return null;
    let raw = input.trim();
    if (!raw || raw.length > 500) return null;
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = 'https://' + raw;
    let u;
    try { u = new URL(raw); } catch (e) { return null; }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    const host = u.hostname.toLowerCase().replace(/^(www|m|music)\./, '');
    const parts = u.pathname.split('/').filter(Boolean);
    let id = null;
    if (host === 'youtu.be') {
      id = parts[0] || null;
    } else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      if (parts[0] === 'watch') id = u.searchParams.get('v');
      else if (['shorts', 'embed', 'live', 'v'].indexOf(parts[0]) !== -1) id = parts[1] || null;
    } else {
      return null;
    }
    if (id === 'videoseries' || (id && !ID_RE.test(id))) id = null;
    const listRaw = u.searchParams.get('list');
    const list = listRaw && LIST_RE.test(listRaw) ? listRaw : null;
    if (!id && !list) return null;
    return { id: id, list: list, type: id ? 'video' : 'playlist' };
  }
  function embedUrl(p) {
    const base = 'https://www.youtube-nocookie.com/embed/';
    if (p.id) return base + p.id + '?playsinline=1&rel=0' + (p.list ? '&list=' + encodeURIComponent(p.list) : '');
    return base + 'videoseries?playsinline=1&rel=0&list=' + encodeURIComponent(p.list);
  }
  function watchUrl(p) {
    if (p.id) return 'https://www.youtube.com/watch?v=' + p.id + (p.list ? '&list=' + encodeURIComponent(p.list) : '');
    return 'https://www.youtube.com/playlist?list=' + encodeURIComponent(p.list);
  }
  function thumbUrl(p) { return p.id ? 'https://i.ytimg.com/vi/' + p.id + '/mqdefault.jpg' : null; }

  /* ---------------- workout session stopwatch ----------------
   * A session never counts paused time:
   *   elapsed = accumMs (time banked before the last resume) + (now - resumedAt while running)
   * It is based on timestamps, so it stays correct even if the browser throttles timers.
   */
  function newSession(meta, now) {
    return {
      workoutId: meta.workoutId || null,
      title: meta.title || 'Free workout',
      category: meta.category || '',
      startedAt: now, accumMs: 0, resumedAt: now, heartbeat: now
    };
  }
  function sessionElapsedMs(s, now) {
    return s.accumMs + (s.resumedAt != null ? Math.max(0, now - s.resumedAt) : 0);
  }
  function pauseSession(s, now) {
    if (s.resumedAt == null) return s;
    return Object.assign({}, s, { accumMs: sessionElapsedMs(s, now), resumedAt: null, heartbeat: now });
  }
  function resumeSession(s, now) {
    if (s.resumedAt != null) return s;
    return Object.assign({}, s, { resumedAt: now, heartbeat: now });
  }
  function validSession(s) {
    return !!s && typeof s === 'object' && typeof s.startedAt === 'number' &&
      typeof s.accumMs === 'number' && isFinite(s.accumMs) && s.accumMs >= 0 &&
      (s.resumedAt === null || typeof s.resumedAt === 'number');
  }
  /* After a reload: if the page was gone for longer than maxGapMs while "running", we cannot know
   * whether the person kept working out, so we stop the clock at the last heartbeat (conservative). */
  function restoreSession(s, now, maxGapMs) {
    if (!validSession(s)) return null;
    if (s.resumedAt != null) {
      const hb = typeof s.heartbeat === 'number' ? Math.max(s.resumedAt, s.heartbeat) : s.resumedAt;
      if (now - hb > maxGapMs) {
        return Object.assign({}, s, {
          accumMs: s.accumMs + (hb - s.resumedAt), resumedAt: null, heartbeat: now, restoredPaused: true
        });
      }
    }
    return s;
  }

  /* ---------------- stats & streaks ---------------- */
  function totalsByDate(sessions) {
    const m = {};
    sessions.forEach(function (s) {
      const e = m[s.date] || (m[s.date] = { sec: 0, count: 0 });
      e.sec += s.activeSeconds;
      e.count++;
    });
    return m;
  }
  function weekTotals(byDate, dateStr) {
    let sec = 0, count = 0, active = 0;
    const days = weekDates(dateStr).map(function (d) {
      const e = byDate[d] || { sec: 0, count: 0 };
      sec += e.sec; count += e.count; if (e.count) active++;
      return { date: d, sec: e.sec, count: e.count };
    });
    return { days: days, sec: sec, count: count, active: active };
  }
  function recentWeeks(byDate, todayStr, n) {
    const out = [], cur = startOfWeek(todayStr);
    for (let i = n - 1; i >= 0; i--) {
      const ws = addDays(cur, -7 * i), t = weekTotals(byDate, ws);
      out.push({ weekStart: ws, sec: t.sec, count: t.count, active: t.active });
    }
    return out;
  }
  /* work / rest are Sets of 'YYYY-MM-DD'. A rest day keeps a streak alive but does not add to it.
   * Today without a workout does not break the streak (you can still train today). */
  function computeStreaks(work, rest, today) {
    const all = Array.from(work).concat(Array.from(rest)).filter(isDateStr).sort();
    if (!all.length) return { current: 0, longest: 0 };
    const min = all[0];
    let current = 0, d = today;
    while (d >= min) {
      if (work.has(d)) current++;
      else if (!rest.has(d) && d !== today) break;
      d = addDays(d, -1);
    }
    let longest = 0, run = 0;
    const last = all[all.length - 1] > today ? all[all.length - 1] : today;
    for (let x = min; x <= last; x = addDays(x, 1)) {
      if (work.has(x)) { run++; if (run > longest) longest = run; }
      else if (!rest.has(x)) run = 0;
    }
    return { current: current, longest: longest };
  }

  /* ---------------- music queue ---------------- */
  function shuffled(arr, rng) {
    const a = arr.slice(), r = rng || Math.random;
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function buildQueue(ids, currentId, shuffle, rng) {
    if (!shuffle) return ids.slice();
    const rest = shuffled(ids.filter(function (x) { return x !== currentId; }), rng);
    return ids.indexOf(currentId) !== -1 ? [currentId].concat(rest) : rest;
  }
  function reshuffle(ids, currentId, rng) {
    const q = shuffled(ids, rng);
    if (q.length > 1 && q[0] === currentId) { const t = q[0]; q[0] = q[1]; q[1] = t; }
    return q;
  }
  /* returns the new index, or -1 when playback should stop */
  function stepQueue(len, index, dir, wrap) {
    if (len === 0) return -1;
    const n = index + dir;
    if (n >= len) return wrap ? 0 : -1;
    if (n < 0) return wrap ? len - 1 : -1;
    return n;
  }

  /* ---------------- import validation ---------------- */
  const str = function (v, max) { return typeof v === 'string' ? v.trim().slice(0, max) : ''; };
  const num = function (v) { return typeof v === 'number' && isFinite(v) ? v : null; };

  function sanitizeWorkout(w) {
    if (!w || typeof w !== 'object') return null;
    const id = str(w.id, 64), title = str(w.title, 120), url = str(w.url, 500);
    if (!id || !title || !parseYouTube(url)) return null;
    const dur = num(w.durationMin);
    return {
      id: id, title: title, url: url,
      category: str(w.category, 40) || 'Other',
      durationMin: dur != null ? Math.min(600, Math.max(0, Math.round(dur))) : 0,
      createdAt: num(w.createdAt) || Date.now(),
      lastUsedAt: num(w.lastUsedAt) || 0
    };
  }
  function sanitizeSession(s) {
    if (!s || typeof s !== 'object') return null;
    const id = str(s.id, 64), sec = num(s.activeSeconds);
    if (!id || !isDateStr(s.date) || sec == null || sec < 0) return null;
    return {
      id: id, workoutId: str(s.workoutId, 64) || null,
      title: str(s.title, 120) || 'Workout', category: str(s.category, 40),
      date: s.date, startedAt: num(s.startedAt) || 0, endedAt: num(s.endedAt) || 0,
      activeSeconds: Math.min(Math.round(sec), 172800), completed: true
    };
  }
  function sanitizeRest(r) {
    if (!r || typeof r !== 'object' || !isDateStr(r.date)) return null;
    return { date: r.date, markedAt: num(r.markedAt) || 0 };
  }
  function sanitizeWeight(w) {
    if (!w || typeof w !== 'object' || !isDateStr(w.date)) return null;
    const kg = num(w.kg);
    if (kg == null || kg < 10 || kg > 700) return null;
    return { date: w.date, kg: Math.round(kg * 10) / 10 };
  }
  function sanitizeTrack(t) {
    if (!t || typeof t !== 'object') return null;
    const id = str(t.id, 64), name = str(t.name, 200);
    if (!id || !name) return null;
    return {
      id: id, name: name, size: num(t.size) || 0,
      type: str(t.type, 60) || 'audio/mpeg',
      order: num(t.order) || 0, addedAt: num(t.addedAt) || 0
    };
  }
  function sanitizeImport(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj) || obj.app !== 'vishesh-workout-studio') {
      return { ok: false, error: 'This file is not a Vishesh Workout Studio backup.' };
    }
    if (typeof obj.version === 'number' && obj.version > 1) {
      return { ok: false, error: 'This backup was made by a newer version of the app.' };
    }
    let skipped = 0;
    function list(v, fn, keyFn) {
      const out = [], seen = new Set();
      if (!Array.isArray(v)) return out;
      v.slice(0, 20000).forEach(function (x) {
        const r = fn(x);
        if (!r) { skipped++; return; }
        const k = keyFn(r);
        if (seen.has(k)) { skipped++; return; }
        seen.add(k); out.push(r);
      });
      return out;
    }
    const data = {
      workouts: list(obj.workouts, sanitizeWorkout, function (r) { return r.id; }),
      sessions: list(obj.sessions, sanitizeSession, function (r) { return r.id; }),
      rest: list(obj.rest, sanitizeRest, function (r) { return r.date; }),
      weights: list(obj.weights, sanitizeWeight, function (r) { return r.date; }),
      tracks: list(obj.tracks, sanitizeTrack, function (r) { return r.id; }),
      goalMin: null
    };
    const g = obj.prefs && num(obj.prefs.dailyGoalMin);
    if (g != null && g >= 5 && g <= 600) data.goalMin = Math.round(g);
    return { ok: true, data: data, skipped: skipped };
  }

  return {
    DEFAULT_CATEGORIES: DEFAULT_CATEGORIES,
    uid: uid, fmtClock: fmtClock, fmtMinutes: fmtMinutes,
    toDateStr: toDateStr, fromDateStr: fromDateStr, isDateStr: isDateStr, addDays: addDays,
    startOfWeek: startOfWeek, weekDates: weekDates, monthMatrix: monthMatrix,
    parseYouTube: parseYouTube, embedUrl: embedUrl, watchUrl: watchUrl, thumbUrl: thumbUrl,
    newSession: newSession, sessionElapsedMs: sessionElapsedMs, pauseSession: pauseSession,
    resumeSession: resumeSession, restoreSession: restoreSession,
    totalsByDate: totalsByDate, weekTotals: weekTotals, recentWeeks: recentWeeks,
    computeStreaks: computeStreaks,
    shuffled: shuffled, buildQueue: buildQueue, reshuffle: reshuffle, stepQueue: stepQueue,
    sanitizeImport: sanitizeImport
  };
});
