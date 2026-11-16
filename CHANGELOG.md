# Change log — revision 3 (2026-11-16), on top of revision 2 and the R1/R2/R3 delivery (2026-11-15)
Nothing was pushed, deployed or published.

## Revision 3 (service-worker cache version) — the ONLY file change
| File | Change |
|---|---|
| sw.js | line 9 only: `VERSION` `2026-11-15-v1` → `2026-11-16-v1` (cache name becomes `vws-2026-11-16-v1`). Nothing else in sw.js changed (diff = 1 line). Reason: revision 2 changed app.js, sync.js and cloud.js but kept the previous VERSION, so a phone that already had `2026-11-15-v1` installed would never see a changed sw.js, never stage a new cache and keep serving the old cached files. |
| mock-browser-tests/e2e_sw_transition.js | new test file (not part of the site) |
No other app file was touched in revision 3 (checked byte-for-byte against revision 2).

**Rule for you from now on:** every time any shell file changes (index.html, styles.css, core.js, firebase-config.js, sync.js, cloud.js, app.js, manifest, icons) bump `VERSION` in sw.js to a new, never-used value before publishing.

## Revision 2 changes (unchanged in revision 3)
| File | Change |
|---|---|
| app.js | **Safety copy wording/content (point 1):** the downloaded file no longer has `tracks`/`videos` keys (so importing it can not create empty song/video entries); it carries `note` ("workouts, sessions, rest days and weights ONLY; song and video files NOT included") and lists media names only under `mediaNotIncluded`. Settings now says under the button: "Songs and imported videos are NOT included". Toast says the same. **Refused-record handling (point 3):** Account "skipped" block adds a hint when the cloud refused records (check latest firestore.rules, then Retry). |
| sync.js | **Point 3:** when a whole batch is refused (after halving), the engine now runs `cloud.probe()` (harmless: re-saves the user's own profile unchanged). Probe OK → the refused record(s) are skipped (works for a lone record on the first push; sync never stays stuck). Probe fails → nothing skipped; error text: "The cloud refused to save your changes (code). Your data is safe on this phone. Check that you are signed in and that the latest firestore.rules is published in Firebase, then tap Sync now." Probe network failure → offline/retry. Removed the old "first push of a session" heuristic. `skipped.refused` count added. |
| cloud.js | new `probe()` (reads profile, writes the same fields back; creates the basic profile if missing). |
| README.md | safety copy explained as NOT a media backup (normal Backup button likewise); refused-record behaviour rewritten. |
| test-r123.js | 12 → 15 tests (systemic w/ probe + message + recovery, lone first-push refusal not stuck, two refused, rules break mid-session, probe network failure). |
| mock-browser-tests/e2e_r2.js | 26 → 30 checks: blob **bytes** compared (hex of the real audio/video bytes), safety-copy content/wording checks. |
| mock-browser-tests/e2e_sync.js, mockfb.js | section 18 (real cloud.js probe vs mock: one refused key, then all writes refused, then fixed); mock hooks `denyKeys`/`denyAll`. |

## Unchanged in this revision
firestore.rules (key ≤ 600), index.html, styles.css, core.js, test-sync.js, emulator-tests, firebase.json. All other changes versus your live repo are listed in the previous change log (core.js/manifest/icons identical to yours; app.js, index.html, styles.css, sw.js, README.md modified; sync.js, cloud.js, firebase-config.js, firestore.rules, firebase.json, FIREBASE_SETUP.md, tests new).

## Layout
`firebase.json` + `firestore.rules` in the project root, `emulator-tests/` beside them, app files in the site root.
