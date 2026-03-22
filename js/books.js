// ─────────────────────────────────────────────────────────────────────────────
// books.js — Real-time book subscription, client-side search, availability badge
// ─────────────────────────────────────────────────────────────────────────────

import { db } from './firebase-config.js';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';

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
