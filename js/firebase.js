import { initializeApp } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js';
import { getAnalytics } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-analytics.js';
import {
  getFirestore,
  collection,
  doc,
  query,
  orderBy,
  onSnapshot,
  setDoc
} from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyCrrAx34HoSNcrKJtsMF25SiEdutUMOMgY',
  authDomain: 'enjc-sport-club.firebaseapp.com',
  projectId: 'enjc-sport-club',
  storageBucket: 'enjc-sport-club.firebasestorage.app',
  messagingSenderId: '753390842589',
  appId: '1:753390842589:web:68682bfe3a059a25042134',
  measurementId: 'G-XSNC62VSHZ'
};

let db;
let analytics;

function initFirebase() {
  if (db) return db;
  const app = initializeApp(firebaseConfig);
  analytics = getAnalytics(app);
  db = getFirestore(app);
  return db;
}

function matchesCollection() {
  return collection(initFirebase(), 'matches');
}

export function subscribeToMatchHistory(onChange, onError) {
  const matchesQuery = query(matchesCollection(), orderBy('id', 'asc'));
  return onSnapshot(matchesQuery, snapshot => {
    const matches = snapshot.docs.map(doc => doc.data());
    onChange(matches);
  }, onError);
}

export function subscribeToMatch(matchId, onChange, onError) {
  const matchRef = doc(matchesCollection(), String(matchId));
  return onSnapshot(matchRef, snapshot => {
    onChange(snapshot.exists() ? snapshot.data() : null);
  }, onError);
}

export async function saveMatch(match) {
  const matchRef = doc(matchesCollection(), String(match.id));
  await setDoc(matchRef, match);
}
