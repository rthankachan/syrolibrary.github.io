// ─────────────────────────────────────────────────────────────────────────────
// students.js — Load all active students once into memory, search client-side
// Decision: Option A — 500 students ≈ 50KB, loaded at login, filtered locally
// ─────────────────────────────────────────────────────────────────────────────

import { db } from './firebase-config.js';
import { collection, getDocs, orderBy, query, where } from 'firebase/firestore';

let _students = null; // null = not yet loaded

// Loads all active students into memory. Safe to call multiple times —
// subsequent calls return the cached array without hitting Firestore.
export async function loadStudents() {
  if (_students !== null) return _students;

  const q = query(
    collection(db, 'students'),
    where('active', '==', true),
    orderBy('name')
  );
  const snap = await getDocs(q);
  _students = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  return _students;
}

// Filter the in-memory list by name or grade.
// Returns at most 8 results for the typeahead dropdown.
export function searchStudents(term) {
  if (!_students || !term.trim()) return [];
  const t = term.toLowerCase();
  return _students
    .filter(s =>
      s.name.toLowerCase().includes(t) ||
      (s.grade && s.grade.toLowerCase().includes(t))
    )
    .slice(0, 8);
}

export function getAllStudents() {
  return _students ?? [];
}

// Call this after adding or editing a student to bust the cache
export function invalidateStudentCache() {
  _students = null;
}
