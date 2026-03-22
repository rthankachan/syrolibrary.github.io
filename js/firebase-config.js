// ─────────────────────────────────────────────────────────────────────────────
// Firebase configuration
// ─────────────────────────────────────────────────────────────────────────────
// 1. Go to Firebase Console → Project Settings → Your apps → Web app
// 2. Copy the firebaseConfig object and paste it below.
// 3. This config is SAFE to be public — your Firestore Security Rules are
//    what protect the data, not keeping this secret.
// ─────────────────────────────────────────────────────────────────────────────

import { initializeApp } from 'firebase/app';
import { getFirestore }  from 'firebase/firestore';
import { getAuth }       from 'firebase/auth';

const firebaseConfig = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_PROJECT_ID.firebaseapp.com",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId:             "YOUR_APP_ID",
};

const app = initializeApp(firebaseConfig);

export const db   = getFirestore(app);
export const auth = getAuth(app);
