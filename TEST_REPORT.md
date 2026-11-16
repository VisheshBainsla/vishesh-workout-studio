# Test report — revision 3 (2026-11-16)

## A. MOCK tests actually run on the final files and PASSED (Node + headless Chromium in my sandbox; fake Firebase / fake cloud)
| Suite | Result | Covers |
|---|---|---|
| node test-core.js | 13 groups | core logic (unchanged) |
| node test-sync.js | 32/32 | merge, conflicts, clock skew, tombstones, migration, account switch (logic) |
| node test-r123.js | 15/15 | validator (+ proof Core.sanitizeImport is unsuitable), key limits, invalid local/remote records, bisecting push, probe: systemic vs single-record refusal, lone first-push refusal not stuck, rules breaking mid-session, probe network failure, account isolation, migration with invalid record |
| e2e_r2.js (browser) | 30/30 | v2→v3: all 7 stores identical **with real Blob bytes compared** (audio "RIFFDATA", video chunk "VIDEOB" read back as bytes, before = after); new stores added; safety copy created, downloadable, contains NO song/video data and says so; Settings wording; reload stable. Newer DB (v4): guard screen, DB unchanged (bytes included). Rollback: old v2 app on v3 DB shows storage banner + empty list, DB untouched, new version shows data again |
| e2e_sync.js (browser, mock Firebase + rules port) | 75/75 | sections 1–16 as before; 17 invalid local/cloud records; 18 cloud refuses one key (not stuck, skipped + recovery text), refuses every write (error + instructions, nothing skipped, uploads after fix) |
| regression: e2e_reg 53, e2e_timer 43, smoke 16, media_live 9, fullscreen 20 | all pass | timer, history, music, video import, backup/restore, layout, fullscreen, PWA cache |

No JS/page errors in any run.

## A2. Service-worker update tests (revision 3) — real service worker in headless Chromium over http://localhost; PASSED 29/29
`mock-browser-tests/e2e_sw_transition.js`. New VERSION `2026-11-16-v1` (differs from your live `2026-11-03-v1`, the 11-10 delivery `2026-11-10-v1` and the 11-15 delivery `2026-11-15-v1`).
1. **Your live site (cached) → new:** old app runs from `vws-2026-11-03-v1`; after the new files are published the update banner appears; the running page stays old until "Update now"; the staged cache `vws-2026-11-16-v1` contains index.html, styles.css, core.js, **firebase-config.js, sync.js, cloud.js, app.js**, manifest and both icons, each **byte-identical to the new file**; after "Update now" the new code runs (sync chip, `VWSSync.validateRecord`, `VWSCloud`), the old cache is deleted, the existing weight is still there and the database is v3; **offline reload** opens the app from the new cache including sync.js/cloud.js.
2. **The trap (why the bump is needed):** same sw.js VERSION with changed app/sync/cloud files → no update banner, and the phone keeps running the old cached sync.js after reload. (Demonstrated with the 2026-11-15-v1 name.)
3. **Previous delivery (2026-11-15-v1, older code) → new:** banner appears, new code runs, old cache deleted.
Not covered here: the update confirmation sheet when a timer is running (covered by the older e2e_update.js scenario, not re-run), and a real GitHub Pages / Android Chrome update. Also smoke (16/16, expects the new VERSION) and e2e_r2 (30/30) were re-run after the bump; the other suites do not depend on sw.js and were not re-run (their code and the app files are unchanged since the last full run).

## B. Answers to your points (revision 2)
1. **Safety copy and media:** it can NOT restore songs or imported videos. It holds workouts, sessions, rest days, weights only; no audio/video bytes (test checks the file for them). Now stated in the file, in Settings and in README. The normal Backup button has always behaved the same.
2. The earlier "byte-for-byte" claim was too strong for media (the old dump compared only blob size/type). The test now compares actual bytes; the claim is valid now for the data in that test (tiny test blobs: 8-byte audio, 6-byte video chunk). Large real files were not tested.
3. Single refused record on first upload: fixed via the probe (tests above). Limitation that remains: the probe distinguishes "cloud/rules/sign-in broken" from "this record refused" only as well as a profile write reflects the records rules; if profile writes work but the *records* rules are wrong (e.g. old rules that lack the 600 limit are still fine for normal keys, but a rules file where `records` is broken while `users/{uid}` is not), the records are skipped (kept, never deleted, Retry button + hint to check the latest firestore.rules) instead of showing an error.

## C. NOT verified (unchanged)
1. Real Firebase project/Auth/Firestore (including whether `probe()` and the real rules behave like the mock).
2. Emulator run of the REAL firestore.rules (`emulator-tests/rules.test.js`, 17 tests) — written, never executed; needs a PC with Node + Java.
3. gstatic SDK loading, real Google sign-in popup/redirect on github.io.
4. Real Android Chrome, installed PWA, IndexedDB quota/eviction, real service-worker update.
5. Large real song/video files through the v2→v3 upgrade.
6. You must publish the new firestore.rules yourself (600 key limit); I did not.
