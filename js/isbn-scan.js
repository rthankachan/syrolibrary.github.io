// ─────────────────────────────────────────────────────────────────────────────
// isbn-scan.js — Camera ISBN barcode scan + Open Library metadata lookup
// ─────────────────────────────────────────────────────────────────────────────

// Strip to 10- or 13-digit ISBN (ISBN-10 may end in X).
export function normalizeIsbn(raw) {
  const s = String(raw || '').replace(/[^0-9Xx]/g, '').toUpperCase();
  if (s.length === 10 || s.length === 13) return s;
  if (s.length > 13) return s.slice(0, 13);
  return s;
}

export function isValidIsbn(isbn) {
  const n = normalizeIsbn(isbn);
  return n.length === 10 || n.length === 13;
}

// Open Library — free, no API key, CORS-friendly.
export async function lookupIsbn(isbn) {
  const normalized = normalizeIsbn(isbn);
  if (!isValidIsbn(normalized)) throw new Error('Invalid ISBN barcode.');

  const url = `https://openlibrary.org/api/books?bibkeys=ISBN:${encodeURIComponent(normalized)}&format=json&jscmd=data`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Book lookup failed. Check your connection.');

  const data = await res.json();
  const hit  = data[`ISBN:${normalized}`];
  if (!hit) throw new Error('No book found for this ISBN. Enter the details manually.');

  const cover = hit.cover?.large || hit.cover?.medium || hit.cover?.small
    || `https://covers.openlibrary.org/b/isbn/${normalized}-L.jpg`;

  const subjects = (hit.subjects || []).map(s => s.name || s).filter(Boolean);

  return {
    isbn:      normalized,
    title:     hit.title || '',
    author:    (hit.authors || []).map(a => a.name).filter(Boolean).join(', '),
    summary:   subjects.slice(0, 6).join(', '),
    imageUrl:  cover.startsWith('http') ? cover : `https:${cover}`,
    publisher: (hit.publishers || []).join(', '),
  };
}

// Wraps html5-qrcode (loaded on first use from esm.sh) for EAN-13 book barcodes.
export class IsbnScanner {
  constructor(containerId) {
    this._containerId = containerId;
    this._scanner     = null;
    this._detected    = false;
  }

  get isActive() {
    return !!this._scanner?.isScanning;
  }

  async start(onIsbn) {
    this._detected = false;
    const { Html5Qrcode, Html5QrcodeSupportedFormats } =
      await import('https://esm.sh/html5-qrcode@2.3.8');

    this._scanner = new Html5Qrcode(this._containerId, {
      formatsToSupport: [
        Html5QrcodeSupportedFormats.EAN_13,
        Html5QrcodeSupportedFormats.EAN_8,
      ],
      verbose: false,
    });

    let camera = { facingMode: 'environment' };
    try {
      const cameras = await Html5Qrcode.getCameras();
      const back = cameras.find(c => /back|rear|environment/i.test(c.label));
      if (back) camera = back.id;
      else if (cameras.length) camera = cameras[cameras.length - 1].id;
    } catch (_) { /* facingMode fallback */ }

    await this._scanner.start(
      camera,
      { fps: 10, qrbox: { width: 280, height: 100 } },
      (decoded) => {
        if (this._detected) return;
        const isbn = normalizeIsbn(decoded);
        if (!isValidIsbn(isbn)) return;
        this._detected = true;
        onIsbn(isbn);
      },
      () => {},
    );
  }

  async stop() {
    if (!this._scanner) return;
    try {
      if (this._scanner.isScanning) await this._scanner.stop();
      this._scanner.clear();
    } catch (_) {}
    this._scanner = null;
    this._detected = false;
  }
}
