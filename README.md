# Vishesh Workout Studio

A private, mobile-first workout website. Pure HTML, CSS and JavaScript: no backend, no accounts, no API keys, no paid services.

## Files

| File | Purpose |
|---|---|
| `index.html` | Page shell (open this) |
| `styles.css` | Black and red theme |
| `core.js` | Logic: YouTube link parsing, stopwatch maths, streaks, stats, backup validation |
| `app.js` | The interface and storage |

## Put it on GitHub Pages (free)

1. Create a new public repository on GitHub.
2. Upload all four files to the top level of the repository (not inside a folder).
3. Repository **Settings → Pages → Build and deployment**: Source = *Deploy from a branch*, Branch = `main`, folder = `/ (root)`. Save.
4. After a minute, open `https://<your-username>.github.io/<repo-name>/` on your phone.
5. In Chrome on Android: menu (⋮) → **Add to Home screen**.

Open it through that `https://` address. YouTube embeds can refuse to play when `index.html` is opened directly from a file (`file://`). The "Open in YouTube" button still works there.

## Where your data lives

| Data | Where |
|---|---|
| Workouts, history, rest days, weights, playlist | IndexedDB in your browser |
| Song files (optional, "Keep a copy" switch) | IndexedDB in your browser |
| Daily goal, shuffle/repeat, active tab, a running session | localStorage (small settings only) |

Nothing is ever uploaded. Browser data can be erased (clearing site data, uninstalling the browser, storage cleaners, private mode), so **it is not a guaranteed backup**. Use **Settings (top right) → Export backup** regularly and keep the JSON file somewhere safe (Drive, email to yourself). Backups do not contain song files, only the playlist names.

## What cannot work perfectly in a mobile browser

- **Local music is not remembered by file path.** Browsers do not allow that. The app stores a copy of the songs in browser storage when it can. If the browser clears it or storage is full, songs show "reselect file". Tap *Add / reselect songs* and pick the same files; they are matched by name and size.
- **YouTube playback cannot be fully controlled.** Some videos block embedding. The app uses YouTube's player API to detect this and highlights an "Open in YouTube" button, but only when the API loads (internet needed). Ads and recommendations are YouTube's, not ours. The app does not know how much of a video you actually watched; you confirm completion yourself.
- **Stopwatch and screen lock.** The timer is based on timestamps, so it stays accurate when the screen sleeps or the browser throttles the page. The screen is kept awake during a session where the browser supports the Wake Lock feature (Chrome on Android does). If the browser kills the tab while the timer was running, the session is restored paused at the last moment the app saw it (within about 5 seconds), because the app cannot know whether you kept training.
- **Music in the background** usually continues with the screen off in Chrome on Android and shows lock-screen controls, but this is up to the browser and the phone's battery settings.
- **No offline install yet.** There is no service worker. After the first visit the app needs the internet to load again, and YouTube needs it anyway.
- **Downloads** go to your phone's Downloads folder; importing means picking that file again.

## Streak rules

A day counts when you save at least one completed session. A rest day does not break the streak but does not add to it either. Today without a workout does not break the streak until the day ends.
