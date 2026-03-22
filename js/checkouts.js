// ─────────────────────────────────────────────────────────────────────────────
// checkouts.js — Checkout, check-in, active checkout queries, overdue logic
// ─────────────────────────────────────────────────────────────────────────────

import { db } from './firebase-config.js';
import {
  collection,
  doc,
  getDocs,
  query,
  where,
  writeBatch,
  serverTimestamp,
  increment,
} from 'firebase/firestore';

// ── Queries ───────────────────────────────────────────────────────────────────

// Returns all active checkouts for a given book (used in Book Detail modal)
export async function getActiveCheckoutsForBook(bookId) {
  const q = query(
    collection(db, 'checkouts'),
    where('bookId',  '==', bookId),
    where('status',  '==', 'active')
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ── Checkout ──────────────────────────────────────────────────────────────────

// Creates a checkout doc and decrements book.availableCopies atomically.
// book     — { id, title }
// student  — { id, name, grade }
// dueDate  — Firestore Timestamp
// user     — { uid, name }
export async function checkoutBook({ book, student, dueDate, user }) {
  const batch = writeBatch(db);

  const checkoutRef = doc(collection(db, 'checkouts'));
  batch.set(checkoutRef, {
    bookId:           book.id,
    bookTitle:        book.title,
    studentId:        student.id,
    studentName:      student.name,
    studentGrade:     student.grade,
    checkedOutAt:     serverTimestamp(),
    dueDate,
    returnedAt:       null,
    status:           'active',
    checkedOutBy:     user.uid,
    checkedOutByName: user.name,
  });

  batch.update(doc(db, 'books', book.id), {
    availableCopies: increment(-1),
    updatedAt:       serverTimestamp(),
  });

  await batch.commit();
}

// ── Check-in ──────────────────────────────────────────────────────────────────

// Marks a checkout as returned and increments book.availableCopies atomically.
export async function checkinBook({ checkoutId, bookId }) {
  const batch = writeBatch(db);

  batch.update(doc(db, 'checkouts', checkoutId), {
    status:     'returned',
    returnedAt: serverTimestamp(),
  });

  batch.update(doc(db, 'books', bookId), {
    availableCopies: increment(1),
    updatedAt:       serverTimestamp(),
  });

  await batch.commit();
}

// ── Overdue logic ─────────────────────────────────────────────────────────────

// Returns { label, cls } for the status badge on an active checkout row.
// cls maps to CSS classes in components.css.
export function getOverdueStatus(dueDate) {
  const due   = dueDate?.toDate ? dueDate.toDate() : new Date(dueDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);

  const diffDays = Math.round((due - today) / 86_400_000);

  if (diffDays < 0)  return { label: 'Overdue',    cls: 'badge-overdue'    };
  if (diffDays <= 3) return { label: 'Due soon',   cls: 'badge-due-soon'   };
  return               { label: 'Checked out',  cls: 'badge-checked-out' };
}
