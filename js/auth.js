// ─────────────────────────────────────────────────────────────────────────────
// auth.js — Google Sign-In, first-login invitation linking, page guard
// ─────────────────────────────────────────────────────────────────────────────

import { auth, db } from './firebase-config.js';
import {
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore';

// Module-level cache — populated once auth resolves, cleared on sign-out
let _userData = null;

export function getCurrentUser() {
  return _userData;
}

// ─────────────────────────────────────────────────────────────────────────────
// resolveUser
// Called after Firebase Auth gives us a firebaseUser.
// Returns a userData object if the user is authorised, null if not.
//
// First-login flow:
//   Admin pre-creates /invitations/{email} with { name, role }.
//   On first login this function reads the invitation, creates /users/{uid},
//   and deletes the invitation. Subsequent logins just update lastLoginAt.
// ─────────────────────────────────────────────────────────────────────────────
async function resolveUser(firebaseUser) {
  const userRef = doc(db, 'users', firebaseUser.uid);
  const userSnap = await getDoc(userRef);

  if (userSnap.exists()) {
    // Returning user — update last login in the background, don't await
    updateDoc(userRef, { lastLoginAt: serverTimestamp() }).catch(console.error);
    return { uid: firebaseUser.uid, ...userSnap.data() };
  }

  // First login — check for a pre-authorised invitation keyed by email
  const email = firebaseUser.email.toLowerCase();
  const invRef = doc(db, 'invitations', email);
  const invSnap = await getDoc(invRef);

  if (invSnap.exists()) {
    const inv = invSnap.data();
    const newUser = {
      email,
      name:         inv.name || firebaseUser.displayName || email,
      role:         inv.role,
      createdAt:    serverTimestamp(),
      lastLoginAt:  serverTimestamp(),
    };
    // Create the permanent user doc, then remove the one-time invitation
    await setDoc(userRef, newUser);
    await deleteDoc(invRef);
    return { uid: firebaseUser.uid, ...newUser };
  }

  // No user doc and no invitation → not authorised
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// signInWithGoogle
// Opens the Google OAuth popup. Returns the raw Firebase user.
// The onAuthStateChanged listener in initAuth will handle the rest.
// ─────────────────────────────────────────────────────────────────────────────
export async function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  const result = await signInWithPopup(auth, provider);
  return result.user;
}

// ─────────────────────────────────────────────────────────────────────────────
// signOutUser
// Clears cache, signs out of Firebase, redirects to login page.
// ─────────────────────────────────────────────────────────────────────────────
export async function signOutUser() {
  _userData = null;
  await signOut(auth);
  window.location.href = 'index.html';
}

// ─────────────────────────────────────────────────────────────────────────────
// initAuth
// Call this on every protected page (and on index.html).
//
// Options:
//   onAuthorized(userData)   — user is valid and has an allowed role
//   onUnauthorized(reason)   — 'unauthenticated' | 'no-access' | 'wrong-role' | 'error'
//   requiredRole             — 'admin' to restrict a page to admins only (default: any role)
//
// Returns the Firebase unsubscribe function in case you need to stop listening.
// ─────────────────────────────────────────────────────────────────────────────
export function initAuth({ onAuthorized, onUnauthorized, requiredRole = null }) {
  const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
    if (!firebaseUser) {
      _userData = null;
      onUnauthorized('unauthenticated');
      return;
    }

    try {
      const userData = await resolveUser(firebaseUser);

      if (!userData) {
        await signOut(auth);
        onUnauthorized('no-access');
        return;
      }

      if (requiredRole && userData.role !== requiredRole) {
        onUnauthorized('wrong-role');
        return;
      }

      _userData = userData;
      onAuthorized(userData);
    } catch (err) {
      console.error('Auth resolution failed:', err);
      onUnauthorized('error');
    }
  });

  return unsubscribe;
}

// ─────────────────────────────────────────────────────────────────────────────
// requireAuth
// Convenience wrapper for protected pages.
// Redirects to index.html if not authenticated or not authorised.
// Admin-only pages: pass 'admin' as requiredRole.
//
// Usage (at the top of any page script):
//   const user = await requireAuth();            // any logged-in volunteer/admin
//   const user = await requireAuth('admin');     // admin-only page
// ─────────────────────────────────────────────────────────────────────────────
export function requireAuth(requiredRole = null) {
  return new Promise((resolve) => {
    initAuth({
      requiredRole,
      onAuthorized: (userData) => resolve(userData),
      onUnauthorized: (reason) => {
        if (reason === 'unauthenticated') {
          window.location.href = 'index.html';
        } else if (reason === 'wrong-role') {
          // Volunteer trying to access admin page — send to dashboard
          window.location.href = 'dashboard.html';
        } else {
          // no-access or error — go to login with message
          window.location.href = 'index.html?denied=1';
        }
      },
    });
  });
}
