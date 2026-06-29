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

/* ─── SAVED TEAMS (shared across all 5 phones) ──────────────── */
async function teamsCol() {
  const d = await initFirebase();
  return collection(d, 'teams');
}
export async function subscribeToTeams(onChange, onError) {
  const col = await teamsCol();
  return onSnapshot(col,
    snapshot => onChange(snapshot.docs.map(d => d.data())),
    onError
  );
}
export async function saveTeamFB(team) {
  const col = await teamsCol();
  await setDoc(doc(col, String(team.id)), { ...team, updatedAt: Date.now() });
}
export async function deleteTeamFB(teamId) {
  const col = await teamsCol();
  await deleteDoc(doc(col, String(teamId)));
}

/* ─── TOURNAMENTS (shared across all 5 phones) ──────────────── */
async function tournamentsCol() {
  const d = await initFirebase();
  return collection(d, 'tournaments');
}
export async function subscribeToTournaments(onChange, onError) {
  const col = await tournamentsCol();
  return onSnapshot(col,
    snapshot => onChange(snapshot.docs.map(d => d.data())),
    onError
  );
}
export async function saveTournamentFB(t) {
  const col = await tournamentsCol();
  await setDoc(doc(col, String(t.id)), { ...t, updatedAt: Date.now() });
}

/* ─── CLUB MEMBERS (shared across all 5 phones) ─────────────── */
async function membersCol() {
  const d = await initFirebase();
  return collection(d, 'members');
}
export async function subscribeToMembers(onChange, onError) {
  const col = await membersCol();
  return onSnapshot(col,
    snapshot => onChange(snapshot.docs.map(d => d.data())),
    onError
  );
}
export async function saveMemberFB(member) {
  const col = await membersCol();
  await setDoc(doc(col, String(member.id)), { ...member, updatedAt: Date.now() });
}
export async function deleteMemberFB(memberId) {
  const col = await membersCol();
  await deleteDoc(doc(col, String(memberId)));
}

/* ─── ATTENDANCE SESSIONS (shared across all 5 phones) ──────── */
async function attendanceCol() {
  const d = await initFirebase();
  return collection(d, 'attendance');
}
export async function subscribeToAttendance(onChange, onError) {
  const col = await attendanceCol();
  return onSnapshot(col,
    snapshot => onChange(snapshot.docs.map(d => d.data())),
    onError
  );
}
export async function saveAttendanceFB(session) {
  const col = await attendanceCol();
  await setDoc(doc(col, String(session.id)), { ...session, updatedAt: Date.now() });
}
