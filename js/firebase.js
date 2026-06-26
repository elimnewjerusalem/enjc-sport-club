import { initializeApp } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js';
import {
  getFirestore,
  collection,
  doc,
  query,
  orderBy,
  onSnapshot,
  setDoc
} from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js';

// TODO: Replace these values with your Firebase project config
const firebaseConfig = {
  apiKey: 'YOUR_API_KEY',
  authDomain: 'YOUR_PROJECT_ID.firebaseapp.com',
  projectId: 'YOUR_PROJECT_ID',
  storageBucket: 'YOUR_PROJECT_ID.appspot.com',
  messagingSenderId: 'YOUR_MESSAGING_SENDER_ID',
  appId: 'YOUR_APP_ID'
};

let db;

function initFirebase() {
  if (db) return db;
  initializeApp(firebaseConfig);
  db = getFirestore();
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
