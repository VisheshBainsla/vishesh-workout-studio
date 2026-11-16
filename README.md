# Vishesh Workout Studio

A private, mobile-first workout website. Plain HTML, CSS and JavaScript. Works fully on the phone with no account. Optional: sign in (Google or email) to keep your history in a private Firebase cloud account (free Spark plan) and restore it on any phone. No paid services.

## Files (put all of them in the top level of your GitHub repository)

| File | Status in this update | Purpose |
|---|---|---|
| `index.html` | modified | Page shell |
| `styles.css` | modified | Black and red theme |
| `core.js` | modified | Logic: timer, streaks, link and video-file checks, backup validation |
| `app.js` | modified | The interface and storage |
| `sw.js` | **new** | Service worker: lets the app open offline |
| `manifest.webmanifest` | **new** | Lets you install the app to your Home screen |
| `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` | **new** | App icons |
| `test-core.js` | modified | Optional: logic tests (`node test-core.js`). Not needed on GitHub |
| `README.md` | modified | This file |
| `sync.js` | **new** | Cloud-sync engine (offline queue, merge, migration check) |
| `cloud.js` | **new** | Firebase sign-in + Firestore adapter (SDK loaded from Google's CDN) |
| `firebase-config.js` | **new** | Your public Firebase web config (empty until you set it up) |
| `firestore.rules` | **new** | Security rules to publish in the Firebase console (not served to the app) |
| `FIREBASE_SETUP.md` | **new** | Step-by-step Firebase setup |
| `test-sync.js` | **new** | Optional: sync logic tests (`node test-sync.js`) |

## Replace the files using only your Android phone

1. Open github.com in Chrome and sign in. Open your repository (the one that holds the site).
2. Tap **Add file → Upload files** (if you only see a "+" icon, tap it and choose **Upload files**).
3. Pick all the files from the table above (the 4 modified site files and the 6 new ones). Files with the same name are replaced.
4. Scroll down, tap **Commit changes**.
5. Wait about a minute, then open your site address (`https://<you>.github.io/<repo>/`). Reload twice.

All paths are relative (`./`), so it works from your repository sub-folder address.

## Your existing data is kept

Workouts, history, rest days, weights and the playlist stay in the same browser database (`vishesh-workout-studio`). It is upgraded **in place** when you open the new version: version 1 → 2 added the video stores earlier, and **version 3** (this update) only *adds* two small stores for cloud sync. No existing store or record is changed or removed by the upgrade. A session that was running in the old version is restored **paused**.

### IndexedDB version 3 stores
| Store | Key | Contents | Goes to the cloud? |
|---|---|---|---|
| `workouts` | `id` | your workout list (YouTube links / saved-video workouts) | yes, when signed in |
| `sessions` | `id` | every completed workout (name, date, start/end, active seconds) | yes |
| `rest` | `date` | rest days | yes |
| `weights` | `date` | weight entries | yes |
| `tracks` | `id` | music playlist details | no (stays on the phone) |
| `videos` | `id` | imported-video details | no |
| `videoChunks` | `[vid, idx]` | imported-video file data | no |
| `sync` **(new in v3)** | `k` (`store\|key`) | per-record sync mark: `updatedAt`, `deleted`, `dirty` (= waiting to upload) | no (bookkeeping only) |
| `syncKv` **(new in v3)** | `k` | small settings: which account owns this phone's data, download position, migration done | no |

Your own records are never modified by sync bookkeeping: the marks live in the separate `sync` store and are written in the same transaction as the record, so a record and its "needs upload" mark are saved together or not at all. Opening the app with an older copy of the files after upgrading can fail to open the database (browsers refuse to downgrade a database): always upload the full set of files.

### Storage safety (v3 upgrade, newer-version guard, rollback)

- The upgrade 2 → 3 only **adds** the `sync` and `syncKv` stores. No existing store is cleared, recreated or rewritten. Right after the first launch on v3 the app also writes a one-time **safety copy** of workouts, sessions, rest days, weights and song/video *names* into a separate tiny database (`vws-safety-snapshot`). Settings → *Download pre-update safety copy* saves a backup file you can import again. **It is NOT a media backup:** it contains workouts, sessions, rest days and weights only. Song and imported-video files (and their chunks) are **not** in it, and the file lists their names only under `mediaNotIncluded` for reference (so importing it can never create empty song/video entries). It can therefore **not** restore songs or videos; those files were not touched by the upgrade and stay inside the app on the phone. The normal *Backup* button behaves the same way: it saves song/video names only, never the media files. Keep your original song and video files elsewhere if you need copies.
- **Newer-version guard:** if the database on the phone is *newer* than the app that is open (browser error `VersionError`), the app does **not** switch to "storage unavailable / memory only" mode. It stops, shows "A newer version of the app is needed", opens nothing and writes nothing. *Update now* / *Reload* fetch the newest app.
- **Rollback warning (important):** an OLD v2 copy of the app can not open a v3 database (browsers refuse to open a database at a lower version). The old app then shows its "Storage unavailable" banner and an empty list. **Your data is still in the v3 database, untouched** (verified in the tests); putting the new version back shows everything again. So: do not roll the site back to the pre-sync files. If a rollback ever happens, do not tap *Delete all app data* in the old app.

### Records that can not be synced (skipped records)

Every record is checked on its own before it is uploaded and again before a downloaded one is saved (`validateRecord` in `sync.js`; stricter checks than the backup importer, but it never changes a record). One bad record never blocks the others.
- Invalid or too-long keys (limit **600** characters after URL-encoding; the rules use the same number), wrong types/ranges, impossible dates, too many fields, etc. → **skipped**.
- If the cloud refuses a batch, it is split until the refused record is alone. Then the app runs a harmless check (it re-saves your own profile unchanged): if that works, sign-in and rules are fine, so the refused record is the problem and only it is skipped (this also holds for a single record on the very first upload, so sync never stays stuck because of one bad record). If the check fails too (rules not published, sign-in problem), nothing is skipped: Account shows an error saying your data is safe on the phone and to check the signed-in account and that the latest `firestore.rules` is published, then tap *Sync now*; queued data uploads by itself once that is fixed.
- Skipped records are **never deleted or changed**. Account shows "N records skipped" with **Save skipped records (JSON)** and **Retry skipped records**. A skipped record is synced automatically after it is edited into a valid state or a valid cloud version arrives.

## Accounts and cloud sync (optional)

Follow **FIREBASE_SETUP.md** once. Until `firebase-config.js` is filled in, the top bar says **Cloud off** and nothing changes. After setup:

- The top bar chip shows **Sign in / Syncing… / Synced / Offline / Sync error / Paused**.
- Sign in with Google or email + password. On first sign-in the app **offers** to copy this phone's existing data to your account. It uploads, reads everything back from the cloud, and only then says it is done. Nothing on the phone is deleted, and the same record is never added twice.
- New workouts, rest days, weights and edits save on the phone first, then upload. Offline changes are queued and upload automatically when you are back online.
- Signing in on another phone restores history, workout names, rest days, weights and streaks (streaks are recalculated from the records).
- **Conflicts:** each record is versioned. A phone never overwrites a newer version: uploads run in a Firestore transaction and the security rules also refuse any write that is not newer than the stored copy. The newest edit wins; a delete and an edit are decided the same way (the later one wins). If two versions carry exactly the same timestamp but different content, every phone applies the same fixed tie rule (a delete beats an edit, otherwise the larger record text wins), so they converge and nothing is marked "synced" while different. A phone with a slow or fast clock still wins when it edits a record it has already downloaded, because its stamp is always newer than the version it replaced. Two phones that create the very same new record (for example a weight for the same date) while offline and unaware of each other are decided by their clocks. Other phones notice changes when the app is opened or brought to the front, when the connection returns, and every 90 seconds while it is open (there is no live push).
- **Google sign-in:** a pop-up is used first; if the browser blocks it, the app falls back to a full-page redirect ("Google window not opening? Use full-page sign-in" is also on the sign-in screen).
- If a phone holds another account's data, the app asks what to do instead of mixing it.
- Song and video files are never uploaded.

## Feature 1: manual timer

- Opening a workout shows **00:00** and **TIMER NOT STARTED**. Nothing starts it: not loading or playing the video, reloading, or switching tabs.
- Big **START TIMER** button. While running it becomes **PAUSE**; when paused it becomes **RESUME**.
- **RESET TO 0** stops the timer and returns to 00:00. If there is recorded time, it asks for confirmation first. Nothing is added to history.
- **FINISH WORKOUT** stops the timer and asks you to confirm. Only active time is saved. Paused time is never counted.
- Finishing without ever starting the timer saves nothing; it tells you why and lets you go back or discard.
- Tapping Finish or Save repeatedly saves exactly one history entry.
- The clock uses timestamps, so it stays correct while the screen is locked or Chrome is in the background.
- If the page reloads or Chrome closes the tab while the timer is running, it comes back **paused** at the last moment the app was alive (checked every 5 s and when the page is hidden). It never counts the time you were away. Tap RESUME on purpose.

## Feature 2: import your own videos

1. Open **Workouts → My Videos → Import Video**. Android's file picker opens.
2. Choose an MP4 or WebM (MOV, 3GP and MKV are tried too). Chrome first checks it can really play it. AVI, WMV and similar are refused with an explanation.
3. Edit the title, optionally set a category, tap **Import video**.
4. Wait for the green **Saved and verified** message. The app copies the video into the browser's database in 8 MB pieces, reads every piece back and checks it (size and SHA-256 fingerprint) before showing success. Keep the screen on and do not leave the page while it runs.
5. Only after that message, the original can be deleted or moved. The saved copy does not use its path.
6. Play it from My Videos. You can also rename, delete (with confirmation), **Use in workout** (creates a workout that plays this video, and the timer stays manual), or **Save copy** (downloads the video file back to your phone as a backup).
7. When adding or editing a workout, choose **Saved video** instead of a YouTube link. YouTube workouts work exactly as before.

If an import fails (no space, file moved, Chrome closed), nothing is saved, the partial copy is removed (also on next start if Chrome was killed), and your other videos are untouched.

## Offline use on Android

1. Open the site once **while online** in Chrome. This saves the app itself. Settings (top right) shows "Offline: the app itself is saved on this phone".
2. Optional but recommended: Chrome menu (⋮) → **Add to Home screen / Install app**. Installed apps are more likely to be granted protected storage.
3. Later, with airplane mode on, open the site or the Home-screen icon. The app and your imported videos work. YouTube workouts and thumbnails need internet.

When you publish a new version, change `VERSION` in `sw.js`. Users see an **Update now** banner. The old version keeps working until they tap it, and a running timer is kept paused.

## Storage limits: please read

- Without an account everything stays on this phone and nothing is uploaded. With an account, workout records (not media files) are also stored in your private cloud account.
- Videos live in Chrome's site storage. **Clearing Chrome's site data, resetting or uninstalling Chrome, or Chrome freeing space can delete them.** Protected storage is requested on your first import, and the result is shown, but it is not guaranteed.
- The quota depends on your phone's free space. The app shows usage and the estimated quota (an estimate, not a promise). If space runs out the import stops with a clear message and nothing already saved is touched.
- **JSON backups do not contain video files or song files**, only their names and details (the Settings screen says so). Use **Save copy** on each video for a real backup. After restoring a JSON backup, videos show "File not on this phone"; import the same file again and it reconnects to the same record.
- Do not rely on this app as your only copy of an important video.

## Other features (unchanged)

Dashboard, YouTube library and player, session history, tracker with calendar, streaks and rest days, weight chart, local music player, export and import of workout data.

## What cannot be guaranteed in a mobile browser

- Playback of unusual codecs (some phone videos use H.265/HEVC); the app tests playability before importing.
- Music files are not remembered by path; the app keeps a copy when it can, otherwise you reselect them.
- Background timers can be frozen by Android; the timer stays accurate because it uses timestamps.
