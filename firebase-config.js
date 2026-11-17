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
    apiKey: 'AIzaSyCPN1_u91dROw5Y21ernKVzPW3S_Ox39j4',
    authDomain: 'vishesh-workout-studio.firebaseapp.com',
    projectId: 'vishesh-workout-studio',
    storageBucket: 'vishesh-workout-studio.firebasestorage.app',
    messagingSenderId: '373610231295',
    appId: '1:373610231295:web:2367d4f28843a7ccf0e3ca'
  }
};
