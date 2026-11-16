# Turn on accounts and cloud sync (Firebase, free Spark plan)

The app code is finished, but **it is not connected to any Firebase project yet**. Until you do the steps
below, the app works exactly as before (everything on the phone) and the Account screen says
"Cloud sync is not set up yet". Nothing in this file requires a credit card. **Never click "Upgrade", "Blaze" or
"Enable billing"**: the free Spark plan is enough.

You can do all of this from Chrome on your Android phone (use "Desktop site" in the Chrome menu if a
page looks cramped), or from any computer. Do the steps in order.

## 1. Create the project
1. Open https://console.firebase.google.com and sign in with your Google account.
2. **Create a project** (or "Add project"). Name: `vishesh-workout-studio` (any name works).
3. Google Analytics: switch it **off** (not needed). Tap **Create project**, then **Continue**.
4. Look at the bottom-left of the console: it should say **Spark** (no cost). Leave it.

## 2. Register the web app and copy its config
1. On the project home page tap the **</>** (Web) icon, or: gear icon → **Project settings** → *Your apps* → **Add app** → **Web**.
2. App nickname: `Workout Studio`. **Do not** tick "Firebase Hosting" (the site stays on GitHub Pages). Tap **Register app**.
3. You will see a block of code with `const firebaseConfig = { apiKey: "...", authDomain: "...", projectId: "...", storageBucket: "...", messagingSenderId: "...", appId: "..." };`. Keep this page open, you need it in step 7.

(These values are public identifiers, not passwords. What keeps your data private is sign-in plus the Firestore rules in step 6.)

## 3. Enable the two sign-in methods
1. Left menu **Build → Authentication → Get started**.
2. **Sign-in method** tab → **Email/Password** → switch **Enable** on (leave "Email link" off) → **Save**.
3. **Add new provider → Google** → **Enable** → choose your email as the *Project support email* → **Save**.

## 4. Allow your website address
1. Authentication → **Settings** tab → **Authorized domains** → **Add domain**.
2. Type exactly `visheshbainsla.github.io` (just the domain: no `https://`, no path). **Add**.
(`localhost` and the `firebaseapp.com` domain are already listed.)

## 5. Create the database
1. **Build → Firestore Database → Create database**.
2. Pick a location close to you, for example **asia-south1 (Mumbai)**. This cannot be changed later.
3. Choose **Start in production mode** (locked) → **Create**.

## 6. Publish the security rules
1. Firestore → **Rules** tab.
2. Delete everything in the editor and paste the whole content of **`firestore.rules`** from this repository (it includes the "write must be newer" rule, so re-publish it if you published an earlier copy).
3. Tap **Publish**.

These rules let a signed-in person read and write **only** `users/<their own uid>/...`. Everyone else, and anyone not signed in, is refused. Records are never really deleted (a delete is stored as a marker) so one phone can never wipe your cloud history by accident.

## 7. Connect the app
1. In your GitHub repository open **`firebase-config.js`** → pencil icon (Edit).
2. Copy each value from step 2 between the quotes: `apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId`, `appId`. Leave `sdkVersion` as it is.
3. **Commit changes.** Wait about a minute.
4. Open https://visheshbainsla.github.io/vishesh-workout-studio/ and reload twice (tap **Update now** if the red banner appears).
5. The top bar now shows **Sign in** instead of **Cloud off**.

## 8. First sign-in checklist (do this once, on your phone)
1. Tap **Sign in → Create account**, or **Continue with Google**.
2. You will be asked whether to **upload this phone's existing data**. Tap **Upload my data**. The app copies it, reads it back from the cloud and only then says *"Your data is in your account"*. Nothing on the phone is deleted.
3. Open **Account → Check my cloud copy**: the "This phone" and "Cloud" columns should match.
4. In the Firebase console → Firestore Database → Data you should see `users → <your uid> → records` with one document per workout, rest day and weight.
5. Sign in on a second phone with the same account: your history, workout names, rest days, weights and streaks appear.

## What is saved, and what is not
Saved in your private account: every completed workout (name, date, start and end time, active duration, category), your saved workout list (YouTube links), rest days, weight entries, your name/email and your daily goal. Streaks and totals are always **recalculated from those records**.
**Not uploaded:** imported video files and song files (they stay on the phone). Workouts that use an imported video sync their *details*, and show "File not on this phone" on other phones.

## Free plan (Spark) limits
Cloud Firestore free quota per project: 1 GiB stored, 50,000 document reads/day, 20,000 writes/day, 20,000 deletes/day. A personal workout log uses a tiny fraction (a few writes per workout; the app only downloads records that changed). Authentication with Google and Email/Password is free. If a daily limit were ever hit, the app keeps working locally and shows "Sync error"; it resumes the next day. Billing only starts if you *choose* to upgrade to Blaze, which this app never asks for.

## Optional hardening
Google Cloud console → APIs & Services → Credentials → your *Browser key* → **Website restrictions** → add `https://visheshbainsla.github.io/*` (and `http://localhost/*` if you test locally). This is extra: the rules already protect your data.

## Troubleshooting
| Message | Fix |
|---|---|
| "This website address is not in Firebase Authorized domains" | Step 4. |
| "This sign-in method is not enabled" | Step 3. |
| "Your browser blocked the Google sign-in window" | Allow pop-ups for the site, tap Google again. |
| "Sync error: Cloud refused the request (check the Firestore rules)" | Step 6: publish `firestore.rules` exactly, and make sure the database was created (step 5). |
| Top bar still says "Cloud off" | `firebase-config.js` still has empty values, or the page is cached: reload twice. |
| "Sync error: Another device is changing the same records" | Temporary: two phones were saving the same record at the same moment. It retries by itself. |
| Google sign-in goes to Google and comes back signed out | Some phone browsers block the cross-site storage the full-page redirect needs. Allow third-party cookies for the site, or use the pop-up / email sign-in. |
| Offline | Normal. Changes are saved on the phone and upload automatically when the connection returns. |

## Notes for the developer
* The Firebase SDK (v10.14.1 modular) is loaded from `https://www.gstatic.com/firebasejs/` the first time it is needed, and cached by the service worker afterwards. No build step.
* Data layout: `users/{uid}` (profile) and `users/{uid}/records/{store}__{key}` with fields `store, key, deleted, data, updatedAt, syncedAt, device, schema`.
* Merge rule: newest `updatedAt` wins per record (ties: delete beats edit, otherwise larger canonical text). Uploads run in a Firestore transaction and `firestore.rules` also requires each write to be newer than the stored copy, so a stale phone cannot overwrite a newer record. A record the cloud has but this phone lacks is added; nothing is deleted because a list is empty.
* No service-account key, admin SDK or secret is used or needed.
* Logic tests: `node test-sync.js`.


## Update note (2026-11-15): record key limit and file layout

- `firestore.rules` now allows a record key of up to **600** characters (URL-encoded) instead of 200. If you already published the older rules, publish the new `firestore.rules` once (Firebase console → Firestore → Rules) — nothing else changes. The app never sends records longer than that; it skips them (see README, "skipped records").
- For the emulator tests keep this layout: `firebase.json` and `firestore.rules` in the project root, and the `emulator-tests/` folder beside them (the test script reads `../firestore.rules` and `../firebase.json`). The emulator tests need a PC (Node + Java); they have not been run yet.
