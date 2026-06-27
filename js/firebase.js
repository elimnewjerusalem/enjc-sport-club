import { initializeApp } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js';
import {
  getFirestore,
  enableIndexedDbPersistence,
  collection,
  doc,
  query,
  orderBy,
  onSnapshot,
  setDoc,
  deleteDoc,
  writeBatch,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js';

/* ─── CONFIG ───────────────────────────────────────────────── */
const firebaseConfig = {
  apiKey:            'AIzaSyCrrAx34HoSNcrKJtsMF25SiEdutUMOMgY',
  authDomain:        'enjc-sport-club.firebaseapp.com',
  projectId:         'enjc-sport-club',
  storageBucket:     'enjc-sport-club.firebasestorage.app',
  messagingSenderId: '753390842589',
  appId:             '1:753390842589:web:68682bfe3a059a25042134'
};

/* ─── INIT ─────────────────────────────────────────────────── */
let db = null;

async function initFirebase() {
  if (db) return db;
  const app = initializeApp(firebaseConfig);
  db = getFirestore(app);

  // Enable offline persistence so scoring works without internet.
  // All 5 users get local cache; Firestore auto-syncs when back online.
  try {
    await enableIndexedDbPersistence(db);
  } catch (e) {
    // 'failed-precondition' = multiple tabs open (ok, other tab has it)
    // 'unimplemented' = browser doesn't support it (rare)
    if (e.code !== 'failed-precondition' && e.code !== 'unimplemented') {
      console.warn('Persistence error:', e.code);
    }
  }

  return db;
}

/* ─── COLLECTION REF ────────────────────────────────────────── */
// Single shared collection — all 5 users see same matches in real-time
async function matchesCol() {
  const d = await initFirebase();
  return collection(d, 'matches');
}

/* ─── SUBSCRIBE: all matches (dashboard) ────────────────────── */
// onSnapshot fires instantly from local cache (offline), then again
// when server confirms — so all 5 users get updates within ~1 second.
export async function subscribeToMatchHistory(onChange, onError) {
  const col = await matchesCol();
  const q   = query(col, orderBy('id', 'desc')); // newest first
  return onSnapshot(q,
    snapshot => onChange(snapshot.docs.map(d => d.data())),
    onError
  );
}

/* ─── SUBSCRIBE: single live match ─────────────────────────── */
// This is the key for 5-user instant sync:
// Scorer taps button → saveMatch() → Firestore write
// Other 4 phones have onSnapshot open on same doc
// → they receive update in <1 second automatically, no polling
export async function subscribeToMatch(matchId, onChange, onError) {
  const col = await matchesCol();
  const ref = doc(col, String(matchId));
  return onSnapshot(ref,
    snap => onChange(snap.exists() ? snap.data() : null),
    onError
  );
}

/* ─── SAVE match ────────────────────────────────────────────── */
export async function saveMatch(match) {
  const col = await matchesCol();
  const ref = doc(col, String(match.id));
  // updatedAt helps debug sync issues
  await setDoc(ref, { ...match, updatedAt: Date.now() });
}

/* ─── DELETE match ──────────────────────────────────────────── */
export async function deleteMatch(matchId) {
  const col = await matchesCol();
  await deleteDoc(doc(col, String(matchId)));
}

/* ─── BATCH DELETE (1-year prune) ───────────────────────────── */
// Called when pruning old matches — deletes from Firestore too
export async function batchDeleteMatches(ids) {
  if (!ids.length) return;
  const col   = await matchesCol();
  const d     = await initFirebase();
  const batch = writeBatch(d);
  ids.forEach(id => batch.delete(doc(col, String(id))));
  await batch.commit();
}
