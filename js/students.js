// ─────────────────────────────────────────────────────────────────────────────
// students.js — In-memory load + typeahead search + CRUD + checkout history
// ─────────────────────────────────────────────────────────────────────────────

import { db } from './firebase-config.js';
import {
  collection, doc, addDoc, updateDoc,
  getDocs, query, where, orderBy,
  serverTimestamp,
} from 'firebase/firestore';

let _students = null; // null = not yet loaded

// ── Read ──────────────────────────────────────────────────────────────────────

// Loads all active students into memory. Cached — call invalidateStudentCache()
// after any mutation to force a fresh fetch on the next call.
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

// Filter the in-memory list by name or grade (used for typeahead on dashboard)
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

export function invalidateStudentCache() {
  _students = null;
}

// Returns all checkouts for a student, split into active and returned arrays.
// Uses the composite index: studentId ASC, status ASC, checkedOutAt DESC
export async function getStudentCheckouts(studentId) {
  const [activeSnap, returnedSnap] = await Promise.all([
    getDocs(query(
      collection(db, 'checkouts'),
      where('studentId', '==', studentId),
      where('status',    '==', 'active')
    )),
    getDocs(query(
      collection(db, 'checkouts'),
      where('studentId', '==', studentId),
      where('status',    '==', 'returned'),
      orderBy('checkedOutAt', 'desc')
    )),
  ]);

  return {
    active:   activeSnap.docs.map(d => ({ id: d.id, ...d.data() })),
    returned: returnedSnap.docs.map(d => ({ id: d.id, ...d.data() })),
  };
}

// ── Create ────────────────────────────────────────────────────────────────────

export async function addStudent({ name, grade }) {
  const ref = await addDoc(collection(db, 'students'), {
    name:      name.trim(),
    grade:     grade.trim(),
    active:    true,
    createdAt: serverTimestamp(),
  });
  invalidateStudentCache();
  return ref;
}

// ── Update ────────────────────────────────────────────────────────────────────

export async function updateStudent(id, { name, grade }) {
  await updateDoc(doc(db, 'students', id), {
    name:  name.trim(),
    grade: grade.trim(),
  });
  invalidateStudentCache();
}
