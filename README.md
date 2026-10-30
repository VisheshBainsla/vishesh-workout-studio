# Vishesh Workout Studio

A private, mobile-first workout website. Plain HTML, CSS and JavaScript: no backend, no accounts, no API keys, no paid services.

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

## Replace the files using only your Android phone

1. Open github.com in Chrome and sign in. Open your repository (the one that holds the site).
2. Tap **Add file → Upload files** (if you only see a "+" icon, tap it and choose **Upload files**).
3. Pick all the files from the table above (the 4 modified site files and the 6 new ones). Files with the same name are replaced.
4. Scroll down, tap **Commit changes**.
5. Wait about a minute, then open your site address (`https://<you>.github.io/<repo>/`). Reload twice.

All paths are relative (`./`), so it works from your repository sub-folder address.

## Your existing data is kept

Workouts, history, rest days, weights and the playlist stay in the same browser database; it is upgraded in place (version 1 to 2) and new storage areas are added. A session that was running in the old version is restored **paused**.

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

- Everything stays on this phone. Nothing is uploaded.
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
