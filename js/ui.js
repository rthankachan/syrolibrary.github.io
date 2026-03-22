// ─────────────────────────────────────────────────────────────────────────────
// ui.js — Toast notifications, modal helpers, HTML escaping
// ─────────────────────────────────────────────────────────────────────────────

// ── Toast ─────────────────────────────────────────────────────────────────────
let _toastContainer = null;

function getToastContainer() {
  if (!_toastContainer) {
    _toastContainer = document.createElement('div');
    _toastContainer.className = 'toast-container';
    document.body.appendChild(_toastContainer);
  }
  return _toastContainer;
}

// type: 'success' | 'error' | 'default'
export function showToast(message, type = 'default') {
  const container = getToastContainer();
  const toast = document.createElement('div');
  toast.className = 'toast' + (type !== 'default' ? ` toast-${type}` : '');
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.transition = 'opacity 0.3s';
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 320);
  }, 3000);
}

// ── Modal ─────────────────────────────────────────────────────────────────────
export function openModal(overlayEl) {
  overlayEl.hidden = false;
  document.body.style.overflow = 'hidden';
  // Focus the first interactive element
  const first = overlayEl.querySelector('button:not([disabled]), input, select');
  if (first) setTimeout(() => first.focus(), 50);
}

export function closeModal(overlayEl) {
  overlayEl.hidden = true;
  document.body.style.overflow = '';
}

// Wire up overlay-click and ESC-key dismissal for a modal.
// Call once after DOM is ready.
export function initModalDismiss(overlayEl) {
  overlayEl.addEventListener('click', (e) => {
    if (e.target === overlayEl) closeModal(overlayEl);
  });
}

// Global ESC handler — closes the topmost open modal
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const open = document.querySelector('.modal-overlay:not([hidden])');
  if (open) closeModal(open);
});

// ── Utilities ─────────────────────────────────────────────────────────────────

// Safely escape a string for insertion into innerHTML
export function escHtml(str) {
  const d = document.createElement('div');
  d.textContent = str ?? '';
  return d.innerHTML;
}

// Format a Firestore Timestamp or JS Date to "Mar 21, 2026"
export function formatDate(value) {
  const date = value?.toDate ? value.toDate() : new Date(value);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day:   'numeric',
    year:  'numeric',
  });
}
