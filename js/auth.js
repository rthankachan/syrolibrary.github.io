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

export const STAFF_ROLES = ['admin', 'volunteer'];

export function isStaff(userData) {
  return STAFF_ROLES.includes(userData?.role);
}

// ─────────────────────────────────────────────────────────────────────────────
// resolveUser
// Called after Firebase Auth gives us a firebaseUser.
// Returns a userData object for the signed-in user.
//
// First-login flow:
//   Admin pre-creates /invitations/{email} with { name, role }.
//   On first login this function reads the invitation, creates /users/{uid},
//   and deletes the invitation. Subsequent logins just update lastLoginAt.
//
// Anyone without an invitation becomes a 'parishioner' — the self-serve role
// used by the book donation drive. It grants no access to library operations.
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

  const parishioner = {
    email,
    name:        firebaseUser.displayName || email,
    role:        'parishioner',
    createdAt:   serverTimestamp(),
    lastLoginAt: serverTimestamp(),
  };
  await setDoc(userRef, parishioner);
  return { uid: firebaseUser.uid, ...parishioner };
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
  window.location.href = 'login.html';
}

// ─────────────────────────────────────────────────────────────────────────────
// initAuth
// Call this on every protected page (and on index.html).
//
// Options:
//   onAuthorized(userData)   — user is valid and has an allowed role
//   onUnauthorized(reason)   — 'unauthenticated' | 'no-access' | 'wrong-role' | 'error'
//   requiredRole             — a role or array of roles allowed on this page
//                              (default: any role, including 'parishioner')
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
        // User has a Firebase Auth session but no user doc and no invitation.
        // Sign them out so they can't linger in a half-authenticated state.
        try { await signOut(auth); } catch (_) {}
        onUnauthorized('no-access');
        return;
      }

      const allowedRoles = requiredRole
        ? (Array.isArray(requiredRole) ? requiredRole : [requiredRole])
        : null;

      if (allowedRoles && !allowedRoles.includes(userData.role)) {
        _userData = userData;
        onUnauthorized('wrong-role', userData);
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
export function requireAuth(requiredRole = STAFF_ROLES) {
  return new Promise((resolve) => {
    initAuth({
      requiredRole,
      onAuthorized: (userData) => resolve(userData),
      onUnauthorized: (reason, userData) => {
        if (reason === 'unauthenticated') {
          window.location.href = 'login.html';
        } else if (reason === 'wrong-role') {
          // Volunteer on an admin page → dashboard; parishioner → donation page
          window.location.href = isStaff(userData) ? 'catalog.html' : 'donate.html';
        } else {
          // no-access or error — go to login with message
          window.location.href = 'login.html?denied=1';
        }
      },
    });
  });
}
