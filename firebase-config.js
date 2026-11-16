/* firebase-config.js — the ONLY file you edit to turn on cloud accounts.
 *
 * Paste your Firebase *web app* config between the quotes (Firebase console -> Project settings ->
 * Your apps -> Web app -> SDK setup and configuration -> "Config"). These values are PUBLIC identifiers
 * by design: they are not passwords and not secrets. What protects your data is Firebase Authentication
 * plus the rules in firestore.rules. NEVER put a service-account key or any private key here.
 *
 * While apiKey / projectId / appId are empty, the app works exactly as before (local only) and the
 * Account screen says that cloud sync is not set up yet.
 */
window.VWS_FIREBASE = {
  sdkVersion: '10.14.1',   // Firebase JS SDK version loaded from Google's CDN (www.gstatic.com/firebasejs)
  config: {
    apiKey: '',
    authDomain: '',
    projectId: '',
    storageBucket: '',
    messagingSenderId: '',
    appId: ''
  }
};
