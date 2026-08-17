// ─────────────────────────────────────────────────────────────────────────────
// donations.js — Book donation drive: wishlist books, parishioner pledges,
//                spreadsheet (CSV) import
//
// Collections
//   /donationBooks/{id}          public read — the wishlist
//   /donationClaims/{id}         public read — one pledge; carries only the
//                                display name (blank when the donor chose to
//                                stay anonymous)
//   /donationContacts/{claimId}  private     — real name / email / phone of the
//                                donor, readable by the donor and admins only
// ─────────────────────────────────────────────────────────────────────────────

import { db } from './firebase-config.js';
import {
  collection, doc, getDocs, deleteDoc, updateDoc,
  onSnapshot, query, where, orderBy, writeBatch, runTransaction,
  serverTimestamp,
} from 'firebase/firestore';

const BOOKS    = 'donationBooks';
const CLAIMS   = 'donationClaims';
const CONTACTS = 'donationContacts';

// ── Read ──────────────────────────────────────────────────────────────────────

export function subscribeToDonationBooks(onUpdate, onError) {
  const q = query(collection(db, BOOKS), orderBy('seq'));
  return onSnapshot(q, (snap) => {
    onUpdate(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  }, onError);
}

export function subscribeToDonationClaims(onUpdate, onError) {
  return onSnapshot(collection(db, CLAIMS), (snap) => {
    onUpdate(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  }, onError);
}

// Admin-only: donor contact details, keyed by claim id
export async function getDonationContacts() {
  const snap = await getDocs(collection(db, CONTACTS));
  const byClaim = {};
  snap.docs.forEach(d => { byClaim[d.id] = d.data(); });
  return byClaim;
}

export function remainingCopies(book, claims) {
  const pledged = claims
    .filter(c => c.bookId === book.id && c.status !== 'cancelled')
    .reduce((sum, c) => sum + (c.qty || 1), 0);
  return Math.max(0, (book.qty || 1) - pledged);
}

// ── Pledge / cancel ───────────────────────────────────────────────────────────

// Creates the public claim and the private contact doc, and bumps the book's
// claimedCount — all in one transaction so two people can't take the last copy.
export async function claimBook({ book, user, donorName, donorEmail, donorPhone, anonymous, qty = 1 }) {
  const claimRef   = doc(collection(db, CLAIMS));
  const contactRef = doc(db, CONTACTS, claimRef.id);
  const bookRef    = doc(db, BOOKS, book.id);

  await runTransaction(db, async (tx) => {
    const fresh = await tx.get(bookRef);
    if (!fresh.exists()) throw new Error('This book is no longer on the list.');

    const data       = fresh.data();
    const totalQty   = data.qty || 1;
    const alreadyGot = data.claimedCount || 0;
    if (alreadyGot + qty > totalQty) {
      throw new Error('Someone just claimed the last copy of this book.');
    }

    tx.update(bookRef, { claimedCount: alreadyGot + qty, updatedAt: serverTimestamp() });

    tx.set(claimRef, {
      bookId:      book.id,
      bookTitle:   book.title,
      donorUid:    user.uid,
      displayName: anonymous ? '' : donorName.trim(),
      anonymous:   !!anonymous,
      qty,
      status:      'pledged',   // 'pledged' | 'received' | 'cancelled'
      createdAt:   serverTimestamp(),
    });

    tx.set(contactRef, {
      claimId:   claimRef.id,
      bookId:    book.id,
      bookTitle: book.title,
      donorUid:  user.uid,
      name:      donorName.trim(),
      email:     (donorEmail || '').trim().toLowerCase(),
      phone:     (donorPhone || '').trim(),
      createdAt: serverTimestamp(),
    });
  });

  return claimRef.id;
}

// Releases the copy back to the wishlist. Donor or admin only (enforced in rules).
export async function cancelClaim(claim) {
  const bookRef = doc(db, BOOKS, claim.bookId);

  await runTransaction(db, async (tx) => {
    const fresh = await tx.get(bookRef);
    if (fresh.exists()) {
      const claimed = fresh.data().claimedCount || 0;
      tx.update(bookRef, {
        claimedCount: Math.max(0, claimed - (claim.qty || 1)),
        updatedAt:    serverTimestamp(),
      });
    }
    tx.delete(doc(db, CLAIMS, claim.id));
    tx.delete(doc(db, CONTACTS, claim.id));
  });
}

// Admin: mark a pledged book as physically handed in (or back to pledged)
export async function setClaimStatus(claimId, status) {
  return updateDoc(doc(db, CLAIMS, claimId), { status });
}

// ── Spreadsheet import ────────────────────────────────────────────────────────

// Minimal RFC-4180 parser — handles quoted fields, escaped quotes and newlines
// inside cells, which the donation spreadsheet has plenty of.
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;

  const src = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field); field = '';
    } else if (ch === '\n') {
      row.push(field); field = '';
      rows.push(row); row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some(c => c.trim())) rows.push(row);

  return rows.filter(r => r.some(c => c.trim()));
}

const norm = (s) => (s || '').trim().toLowerCase().replace(/[^a-z]/g, '');

function findHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    if (rows[i].some(c => norm(c) === 'booktitle' || norm(c) === 'title')) return i;
  }
  return -1;
}

function money(v) {
  const n = parseFloat(String(v || '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

// Left blank when the spreadsheet says nothing, rather than guessing "Used"
function condition(v) {
  if (!v) return '';
  return /new/i.test(v) ? 'New' : 'Used';
}

// An age cell always starts with a digit ("4-8", "7 & up"). Rows that carry an
// extra Author column push the denomination into that slot instead, which is
// how the shifted rows in the source spreadsheet are detected.
const looksLikeAge = (v) => /^\s*\d/.test(v || '');

// Doc ids are derived from the title so re-uploading the same spreadsheet
// updates the existing rows instead of creating duplicates.
export function bookDocId(title) {
  const slug = (title || '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 90);
  let hash = 0;
  for (const ch of (title || '')) hash = ((hash << 5) - hash + ch.charCodeAt(0)) | 0;
  return `${slug || 'book'}-${Math.abs(hash).toString(36)}`;
}

// Turns raw CSV rows into donationBook objects.
// Returns { books, skipped } — skipped counts rows with no usable title.
export function normalizeDonationRows(rows) {
  const headerIdx = findHeaderRow(rows);
  if (headerIdx === -1) {
    throw new Error('Could not find a header row containing "Book Title".');
  }

  const header     = rows[headerIdx].map(norm);
  const col        = (...names) => header.findIndex(h => names.includes(h));
  const iTitle     = col('booktitle', 'title');
  const iSeq       = col('', 'no', 'number');   // the "#" column normalises to ''
  const iAuthor    = col('author');
  const iDenom     = col('denomination');
  const iAge       = col('categorybyage', 'age', 'agegroup');
  const iPublisher = col('publisher');
  const iCondition = col('newused', 'condition');
  const iUnitPrice = col('unitprice', 'price');
  const iQty       = col('qty', 'quantity');
  const iLink      = col('linktopurchase', 'link', 'url');

  // Header has no Author column, but some rows still carry one — everything
  // after the title shifts right by one on those rows.
  const authorInHeader = iAuthor !== -1;

  const books   = [];
  let   skipped = 0;

  rows.slice(headerIdx + 1).forEach((r, n) => {
    const cell  = (i, shift = 0) => (i === -1 ? '' : (r[i + shift] || '').trim());
    const title = cell(iTitle).replace(/\s+/g, ' ').trim();
    if (!title) { skipped++; return; }

    let shift = 0, author = authorInHeader ? cell(iAuthor) : '';
    if (!authorInHeader && iAge !== -1 && !looksLikeAge(cell(iAge))) {
      shift  = 1;
      author = (r[iAge - 1] || '').trim();  // the slot right after the title
    }

    books.push({
      id:          bookDocId(title),
      title,
      author,
      seq:         parseInt(cell(iSeq), 10) || (n + 1),
      denomination: cell(iDenom, shift),
      ageRange:    cell(iAge, shift),
      publisher:   cell(iPublisher, shift),
      condition:   condition(cell(iCondition, shift)),
      unitPrice:   money(cell(iUnitPrice, shift)),
      qty:         parseInt(cell(iQty, shift), 10) || 1,
      purchaseUrl: /^https?:\/\//i.test(cell(iLink, shift)) ? cell(iLink, shift) : '',
    });
  });

  return { books, skipped };
}

// Writes books in batches. Existing docs keep their claimedCount because the
// payload never includes it.
export async function importDonationBooks(books, onProgress) {
  const CHUNK = 300;
  let written = 0, created = 0, updated = 0;

  const existing = new Set((await getDocs(collection(db, BOOKS))).docs.map(d => d.id));

  for (let i = 0; i < books.length; i += CHUNK) {
    const batch = writeBatch(db);
    for (const b of books.slice(i, i + CHUNK)) {
      const { id, ...data } = b;
      const isNew = !existing.has(id);
      isNew ? created++ : updated++;
      batch.set(doc(db, BOOKS, id), {
        ...data,
        ...(isNew ? { claimedCount: 0, createdAt: serverTimestamp() } : {}),
        updatedAt: serverTimestamp(),
      }, { merge: true });
    }
    await batch.commit();
    written += Math.min(CHUNK, books.length - i);
    onProgress?.(written, books.length);
  }

  return { created, updated };
}

// Refuses to delete a book that someone has already pledged.
export async function deleteDonationBook(id) {
  const snap = await getDocs(query(collection(db, CLAIMS), where('bookId', '==', id)));
  if (!snap.empty) {
    throw new Error('Someone has already pledged this book. Cancel the pledge first.');
  }
  return deleteDoc(doc(db, BOOKS, id));
}

// ── Export ────────────────────────────────────────────────────────────────────

const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(rows) {
  return rows.map(r => r.map(csvCell).join(',')).join('\n');
}

export function downloadCsv(filename, csv) {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a   = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
