// ─────────────────────────────────────────────────────────────────────────────
// volunteers.js — Read/add/remove volunteers and pending invitations
// ─────────────────────────────────────────────────────────────────────────────

import { db } from './firebase-config.js';
import {
  collection, doc, getDoc, getDocs,
  setDoc, updateDoc, deleteDoc, query, where,
  serverTimestamp,
} from 'firebase/firestore';

// ── Read ──────────────────────────────────────────────────────────────────────

// All activated volunteers (role == 'volunteer' in /users)
export async function getVolunteers() {
  const snap = await getDocs(
    query(collection(db, 'users'), where('role', '==', 'volunteer'))
  );
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// All pending invitations (not yet activated)
export async function getPendingInvitations() {
  const snap = await getDocs(collection(db, 'invitations'));
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ── Add ───────────────────────────────────────────────────────────────────────

// Creates a /invitations/{email} doc.
// The invited person's first Google sign-in will consume this and create
// their /users/{uid} doc automatically (handled in auth.js).
export async function addVolunteerInvitation({ name, email, addedBy }) {
  const normalizedEmail = email.toLowerCase().trim();

  // Someone who already signed in through the donation drive has a
  // 'parishioner' account — promote it instead of inviting them again.
  const existingSnap = await getDocs(
    query(collection(db, 'users'), where('email', '==', normalizedEmail))
  );
  if (!existingSnap.empty) {
    const existing = existingSnap.docs[0];
    if (existing.data().role !== 'parishioner') {
      throw new Error('This email already has access.');
    }
    await updateDoc(existing.ref, { role: 'volunteer', name: name.trim() });
    return { promoted: true };
  }

  // Reject if an invitation for this email is already pending
  const invSnap = await getDoc(doc(db, 'invitations', normalizedEmail));
  if (invSnap.exists()) {
    throw new Error('An invitation for this email is already pending.');
  }

  return setDoc(doc(db, 'invitations', normalizedEmail), {
    name:      name.trim(),
    email:     normalizedEmail,
    role:      'volunteer',
    addedBy,
    createdAt: serverTimestamp(),
  });
}

// ── Remove ────────────────────────────────────────────────────────────────────

// Revokes access for an activated volunteer by deleting their /users doc.
// On their next page load, requireAuth will find no user doc → redirect to login.
export async function removeVolunteer(uid) {
  return deleteDoc(doc(db, 'users', uid));
}

// Cancels a pending invitation before the person has logged in.
export async function revokeInvitation(email) {
  return deleteDoc(doc(db, 'invitations', email.toLowerCase()));
}
