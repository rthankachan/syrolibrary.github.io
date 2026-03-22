// ─────────────────────────────────────────────────────────────────────────────
// books.js — Real-time subscription, client-side search, availability badge, CRUD
// ─────────────────────────────────────────────────────────────────────────────

import { db } from './firebase-config.js';
import {
  collection, doc, addDoc, updateDoc, deleteDoc,
  onSnapshot, getDocs, query, where, orderBy,
  serverTimestamp,
} from 'firebase/firestore';

// ── Read ──────────────────────────────────────────────────────────────────────

// Subscribe to all books ordered by title.
// onUpdate(books[]) is called immediately and on every change.
// Returns the Firestore unsubscribe function.
export function subscribeToBooks(onUpdate) {
  const q = query(collection(db, 'books'), orderBy('title'));
  return onSnapshot(q, (snap) => {
    const books = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    onUpdate(books);
  });
}

// Client-side filter — matches title, author, or ISBN
export function filterBooks(books, term) {
  if (!term) return books;
  const t = term.toLowerCase();
  return books.filter(b =>
    b.title.toLowerCase().includes(t)  ||
    b.author.toLowerCase().includes(t) ||
    (b.isbn && b.isbn.includes(t))
  );
}

// Returns { label, cls } for the availability badge on a book card
export function getAvailabilityBadge(book) {
  if (book.availableCopies > 0) {
    const label = book.totalCopies > 1
      ? `Available (${book.availableCopies}/${book.totalCopies})`
      : 'Available';
    return { label, cls: 'badge-available' };
  }
  return { label: 'Checked out', cls: 'badge-checked-out' };
}

// ── Create ────────────────────────────────────────────────────────────────────

export async function addBook({ title, author, isbn, totalCopies, summary, labels }) {
  return addDoc(collection(db, 'books'), {
    title:           title.trim(),
    author:          author.trim(),
    isbn:            isbn.trim(),
    summary:         summary.trim(),
    labels:          labels ?? [],
    totalCopies,
    availableCopies: totalCopies,
    createdAt:       serverTimestamp(),
    updatedAt:       serverTimestamp(),
  });
}

// ── Update ────────────────────────────────────────────────────────────────────

// Recalculates availableCopies when totalCopies changes:
//   checkedOut = old totalCopies − old availableCopies
//   new available = new totalCopies − checkedOut  (floored at 0)
export async function updateBook(id, { title, author, isbn, totalCopies, summary, labels }, currentBook) {
  const checkedOut   = currentBook.totalCopies - currentBook.availableCopies;
  const newAvailable = Math.max(0, totalCopies - checkedOut);
  return updateDoc(doc(db, 'books', id), {
    title:           title.trim(),
    author:          author.trim(),
    isbn:            isbn.trim(),
    summary:         summary.trim(),
    labels:          labels ?? [],
    totalCopies,
    availableCopies: newAvailable,
    updatedAt:       serverTimestamp(),
  });
}

// ── Delete ────────────────────────────────────────────────────────────────────

// Refuses to delete if the book has active checkouts.
export async function deleteBook(id) {
  const snap = await getDocs(
    query(collection(db, 'checkouts'),
      where('bookId', '==', id),
      where('status', '==', 'active'))
  );
  if (!snap.empty) {
    throw new Error('This book has active checkouts. Check it in before deleting.');
  }
  return deleteDoc(doc(db, 'books', id));
}
