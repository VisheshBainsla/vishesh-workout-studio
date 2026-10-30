const C = require('./core.js');
const assert = require('assert');
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok -', name); };

t('YouTube URL parsing', () => {
  const id = 'dQw4w9WgXcQ';
  [`https://www.youtube.com/watch?v=${id}`, `https://youtu.be/${id}?si=abc`, `youtube.com/shorts/${id}`,
   `https://m.youtube.com/watch?v=${id}&t=10`, `https://www.youtube.com/embed/${id}`, `https://youtube.com/live/${id}`,
   `https://music.youtube.com/watch?v=${id}`].forEach(u => assert.strictEqual(C.parseYouTube(u).id, id, u));
  const pl = C.parseYouTube('https://www.youtube.com/playlist?list=PLabcdefghij123');
  assert.deepStrictEqual([pl.id, pl.type, pl.list], [null, 'playlist', 'PLabcdefghij123']);
  const both = C.parseYouTube(`https://www.youtube.com/watch?v=${id}&list=PLabcdefghij123`);
  assert.ok(both.id && both.list);
  ['', 'hello', 'https://vimeo.com/123', 'https://evil.com/watch?v=dQw4w9WgXcQ', 'javascript:alert(1)',
   'https://youtube.com/watch?v=short', 'https://youtube.com/embed/videoseries', 'https://notyoutube.com/?v=dQw4w9WgXcQ',
   'https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ'].forEach(u => assert.strictEqual(C.parseYouTube(u), null, u));
  assert.strictEqual(C.embedUrl({ id, list: null }), `https://www.youtube-nocookie.com/embed/${id}?playsinline=1&rel=0`);
  assert.strictEqual(C.watchUrl({ id, list: null }), `https://www.youtube.com/watch?v=${id}`);
});

t('timer is manual: a new session is idle and counts nothing', () => {
  const s = C.newSession({ title: 'x' }, 1000);
  assert.strictEqual(C.timerState(s), 'idle');
  assert.strictEqual(C.sessionElapsedMs(s, 999999999), 0);          // 00:00 forever until started
  assert.ok(s.id && s.timerStartedAt === null && s.resumedAt === null);
  assert.strictEqual(C.pauseSession(s, 5000), s);                    // pausing an idle timer is a no-op
});

t('stopwatch excludes paused time', () => {
  let s = C.newSession({ title: 'x' }, 1000);
  s = C.startTimer(s, 2000);
  assert.strictEqual(C.timerState(s), 'running');
  assert.strictEqual(C.sessionElapsedMs(s, 12000), 10000);
  s = C.pauseSession(s, 12000);                          // 10s active
  assert.strictEqual(C.timerState(s), 'paused');
  assert.strictEqual(C.sessionElapsedMs(s, 500000), 10000); // long pause not counted
  s = C.resumeSession(s, 500000);
  assert.strictEqual(C.sessionElapsedMs(s, 505000), 15000);
  s = C.pauseSession(s, 505000);
  assert.strictEqual(C.pauseSession(s, 999999), s);      // pausing twice is a no-op
  assert.strictEqual(C.sessionElapsedMs(s, 9e9), 15000);
  assert.strictEqual(s.timerStartedAt, 2000);            // remembers the first start
  assert.strictEqual(C.startTimer(C.startTimer(s, 600000), 700000).resumedAt, 600000); // double start is a no-op
});

t('reset to zero', () => {
  let s = C.startTimer(C.newSession({}, 0), 1000);
  s = C.pauseSession(s, 61000);
  assert.strictEqual(C.sessionElapsedMs(s, 61000), 60000);
  const r = C.resetTimer(s, 70000);
  assert.strictEqual(C.timerState(r), 'idle');
  assert.strictEqual(C.sessionElapsedMs(r, 99999999), 0);
  assert.strictEqual(r.id, s.id);                        // same session, same id
  const run = C.resetTimer(C.startTimer(C.newSession({}, 0), 1000), 5000); // reset while running stops it
  assert.strictEqual(C.timerState(run), 'idle');
});

t('restored session is NEVER silently running', () => {
  let s = C.startTimer(C.newSession({}, 1000), 1000); s.heartbeat = 6000;
  const r = C.restoreSession(s, 10 * 60 * 1000);         // away 10 min while "running"
  assert.strictEqual(r.resumedAt, null);
  assert.strictEqual(C.timerState(r), 'paused');
  assert.strictEqual(C.sessionElapsedMs(r, 99999999), 5000); // stopped at the last heartbeat
  assert.ok(r.restoredPaused);
  const quick = C.restoreSession(s, 20000);               // even an instant reload requires a manual resume
  assert.strictEqual(quick.resumedAt, null);
  assert.strictEqual(C.sessionElapsedMs(quick, 99999999), 5000);
  const idle = C.restoreSession(C.newSession({}, 1000), 50000);
  assert.strictEqual(C.timerState(idle), 'idle');         // an idle session stays idle (00:00)
  const paused = C.restoreSession(C.pauseSession(C.startTimer(C.newSession({}, 0), 1000), 4000), 9e6);
  assert.strictEqual(C.sessionElapsedMs(paused, 9e9), 3000);
  assert.strictEqual(C.restoreSession({ junk: 1 }, 1), null);
  assert.strictEqual(C.restoreSession(null, 1), null);
  // sessions saved by the previous app version (no id / timerStartedAt) are upgraded, not lost
  const old = C.restoreSession({ title: 'old', startedAt: 1000, accumMs: 4000, resumedAt: null, heartbeat: 1000 }, 5000);
  assert.ok(old.id); assert.strictEqual(C.timerState(old), 'paused');
  const oldRun = C.restoreSession({ title: 'old', startedAt: 1000, accumMs: 0, resumedAt: 1000, heartbeat: 3000 }, 9000);
  assert.strictEqual(C.sessionElapsedMs(oldRun, 9e9), 2000);
});

t('streaks', () => {
  const W = a => new Set(a), today = '2026-10-29';
  assert.deepStrictEqual(C.computeStreaks(W([]), W([]), today), { current: 0, longest: 0 });
  assert.strictEqual(C.computeStreaks(W(['2026-10-27', '2026-10-28']), W([]), today).current, 2);   // today pending, not broken
  assert.strictEqual(C.computeStreaks(W(['2026-10-26', '2026-10-28', '2026-10-29']), W([]), today).current, 2); // gap on 27th
  assert.strictEqual(C.computeStreaks(W(['2026-10-26', '2026-10-28', '2026-10-29']), W(['2026-10-27']), today).current, 3); // rest bridges
  assert.strictEqual(C.computeStreaks(W(['2026-10-25']), W([]), today).current, 0);
  const l = C.computeStreaks(W(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-10']), W([]), today);
  assert.deepStrictEqual(l, { current: 0, longest: 3 });
  assert.strictEqual(C.computeStreaks(W(['2026-10-29']), W(['2026-10-28']), today).current, 1);
});

t('dates, weeks, month matrix', () => {
  assert.strictEqual(C.startOfWeek('2026-10-29'), '2026-10-26'); // Thursday -> Monday
  assert.strictEqual(C.startOfWeek('2026-11-01'), '2026-10-26'); // Sunday belongs to the week before
  assert.strictEqual(C.addDays('2026-10-31', 1), '2026-11-01');
  assert.strictEqual(C.addDays('2026-03-01', -1), '2026-02-28');
  assert.strictEqual(C.fromDateStr('2026-02-30'), null);
  const m = C.monthMatrix(2026, 9); // October 2026 starts on Thursday
  assert.strictEqual(m[0][3], '2026-10-01'); assert.strictEqual(m[0][0], null);
  assert.ok(m.every(r => r.length === 7));
  assert.strictEqual(m.flat().filter(Boolean).length, 31);
});

t('totals and formatting', () => {
  const ss = [{ date: '2026-10-28', activeSeconds: 600 }, { date: '2026-10-28', activeSeconds: 300 }, { date: '2026-10-26', activeSeconds: 60 }];
  const by = C.totalsByDate(ss);
  assert.deepStrictEqual(by['2026-10-28'], { sec: 900, count: 2 });
  const w = C.weekTotals(by, '2026-10-29');
  assert.deepStrictEqual([w.sec, w.count, w.active], [960, 3, 2]);
  assert.strictEqual(C.recentWeeks(by, '2026-10-29', 8).length, 8);
  assert.strictEqual(C.fmtClock(65), '01:05'); assert.strictEqual(C.fmtClock(3725), '1:02:05');
  assert.strictEqual(C.fmtMinutes(0), '0 min'); assert.strictEqual(C.fmtMinutes(20), '<1 min');
  assert.strictEqual(C.fmtMinutes(1500), '25 min'); assert.strictEqual(C.fmtMinutes(3900), '1h 05m');
});

t('import validation', () => {
  assert.strictEqual(C.sanitizeImport({}).ok, false);
  assert.strictEqual(C.sanitizeImport(null).ok, false);
  assert.strictEqual(C.sanitizeImport({ app: 'vishesh-workout-studio', version: 9 }).ok, false);
  assert.strictEqual(C.sanitizeImport({ app: 'vishesh-workout-studio', version: 2 }).ok, true);
  const r = C.sanitizeImport({
    app: 'vishesh-workout-studio', version: 1, prefs: { dailyGoalMin: 45 },
    workouts: [{ id: 'a', title: 'Good', url: 'https://youtu.be/dQw4w9WgXcQ', category: 'Full Body', durationMin: 20 },
               { id: 'b', title: 'Bad url', url: 'https://example.com' }, { id: 'a', title: 'dup', url: 'https://youtu.be/dQw4w9WgXcQ' }, 5],
    sessions: [{ id: 's1', date: '2026-10-28', activeSeconds: 900, title: 'T' }, { id: 's2', date: 'nope', activeSeconds: 5 }, { id: 's3', date: '2026-10-28', activeSeconds: -4 }],
    rest: [{ date: '2026-10-27' }, { date: 'x' }], weights: [{ date: '2026-10-28', kg: 70.04 }, { date: '2026-10-28', kg: 5 }],
    tracks: [{ id: 't', name: 'song.mp3', size: 10 }]
  });
  assert.ok(r.ok);
  assert.deepStrictEqual([r.data.workouts.length, r.data.sessions.length, r.data.rest.length, r.data.weights.length, r.data.tracks.length], [1, 1, 1, 1, 1]);
  assert.strictEqual(r.skipped, 7);
  assert.strictEqual(r.data.goalMin, 45); assert.strictEqual(r.data.weights[0].kg, 70);
});

t('music queue', () => {
  const ids = ['a', 'b', 'c', 'd'];
  assert.deepStrictEqual(C.buildQueue(ids, 'b', false), ids);
  const q = C.buildQueue(ids, 'c', true); assert.strictEqual(q[0], 'c'); assert.deepStrictEqual(q.slice().sort(), ids);
  assert.strictEqual(C.stepQueue(4, 3, 1, true), 0); assert.strictEqual(C.stepQueue(4, 3, 1, false), -1);
  assert.strictEqual(C.stepQueue(4, 0, -1, true), 3); assert.strictEqual(C.stepQueue(4, 1, 1, false), 2);
  assert.strictEqual(C.stepQueue(0, 0, 1, true), -1);
  const rs = C.reshuffle(ids, 'a', () => 0.99); assert.notStrictEqual(rs[0], 'a');
});
t('video file validation', () => {
  assert.deepStrictEqual(C.videoFileCheck('a.mp4', 'video/mp4'), { ok: true, ext: 'mp4', mime: 'video/mp4' });
  assert.strictEqual(C.videoFileCheck('a.WEBM', '').mime, 'video/webm');           // empty MIME from Android: use extension
  assert.strictEqual(C.videoFileCheck('clip', 'video/webm').ok, true);             // no extension: use MIME
  assert.strictEqual(C.videoFileCheck('a.avi', 'video/x-msvideo').ok, false);
  assert.ok(/MP4/.test(C.videoFileCheck('a.wmv', '').error));
  assert.strictEqual(C.videoFileCheck('notes.txt', 'text/plain').ok, false);
  assert.strictEqual(C.videoFileCheck('song.mp3', 'audio/mpeg').ok, false);
  assert.strictEqual(C.videoFileCheck('x.mov', 'video/quicktime').ok, true);
  assert.strictEqual(C.fileExt('My.Video.MP4'), 'mp4'); assert.strictEqual(C.stripExt('My.Video.MP4'), 'My.Video');
});

t('chunk plan covers the file exactly', () => {
  const p = C.chunkPlan(20, 8);
  assert.deepStrictEqual(p.map(c => [c.start, c.end]), [[0, 8], [8, 16], [16, 20]]);
  assert.deepStrictEqual(C.chunkPlan(16, 8).length, 2);
  assert.deepStrictEqual(C.chunkPlan(0, 8), []);
  const big = C.chunkPlan(1234567891, 8 * 1048576);
  assert.strictEqual(big[big.length - 1].end, 1234567891);
  assert.strictEqual(big.reduce((a, c) => a + (c.end - c.start), 0), 1234567891);
  assert.strictEqual(C.fmtBytes(1536), '2 KB'); assert.strictEqual(C.fmtBytes(5 * 1048576), '5.0 MB');
});

t('backup v2: videos metadata only, local-video workouts', () => {
  const r = C.sanitizeImport({ app: 'vishesh-workout-studio', version: 2,
    workouts: [{ id: 'w1', title: 'Local one', url: '', videoId: 'v1', category: 'Full Body', durationMin: 10 },
               { id: 'w2', title: 'Neither', url: '' }, { id: 'w3', title: 'Bad link + video', url: 'https://x.com', videoId: 'v1' }],
    videos: [{ id: 'v1', title: 'Leg day', fileName: 'leg.mp4', size: 1000, mime: 'video/mp4', durationSec: 600, hasBlob: true, chunkCount: 9, poster: 'data:xx' },
             { id: 'v1', title: 'dup' }, { title: 'no id' }] });
  assert.ok(r.ok);
  assert.strictEqual(r.data.workouts.length, 1); assert.strictEqual(r.data.workouts[0].videoId, 'v1');
  assert.strictEqual(r.data.videos.length, 1);
  const v = r.data.videos[0];
  assert.strictEqual(v.hasBlob, false);   // an imported record never claims to have the file
  assert.strictEqual(v.chunkCount, 0); assert.strictEqual(v.poster, ''); assert.strictEqual(v.durationSec, 600);
  const old = C.sanitizeImport({ app: 'vishesh-workout-studio', version: 1, workouts: [{ id: 'a', title: 'T', url: 'https://youtu.be/dQw4w9WgXcQ' }] });
  assert.ok(old.ok && old.data.videos.length === 0 && old.data.workouts[0].videoId === null); // v1 backups still import
});

console.log('\nAll ' + n + ' core test groups passed');
