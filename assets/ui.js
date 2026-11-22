// DBMCI One · small UI helpers shared by every page.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// Escape anything that comes from the sheet, Firestore or a user before it touches innerHTML.
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const fmt = n => (typeof n === 'number' ? n.toLocaleString('en-IN') : n);

export function initials(name) {
  return String(name || '').replace(/^dr\.?\s*/i, '').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '·';
}

// ── Icons (1.5px strokes, 20×20) ─────────────────────────────
const P = {
  attendance: '<path d="M3 17V9M8 17V4M13 17v-6M18 17V7"/>',
  issues: '<path d="M10 3 2.5 16.5h15L10 3Z"/><path d="M10 8.5v3.5M10 14.5v.01"/>',
  ratings: '<path d="m10 2.8 2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5L2.8 8.1l5-.7L10 2.8Z"/>',
  wall: '<rect x="2.5" y="3.5" width="15" height="13" rx="1.5"/><path d="m2.5 13 4-4 3.5 3.5 2.5-2.5 5 5"/><circle cx="13.5" cy="7.5" r="1.25"/>',
  admin: '<path d="M10 2.5 3.5 5v4.5c0 4 2.8 7 6.5 8 3.7-1 6.5-4 6.5-8V5L10 2.5Z"/><path d="m7.5 10 1.75 1.75L12.75 8"/>',
  report: '<path d="M5 2.5h6.5L15 6v11.5H5z"/><path d="M11.5 2.5V6H15M7.5 10h5M7.5 13h5"/>',
  logout: '<path d="M8 3.5H4.5v13H8M13 6.5 16.5 10 13 13.5M16.5 10H8"/>',
  sun: '<circle cx="10" cy="10" r="3.25"/><path d="M10 2v1.5M10 16.5V18M2 10h1.5M16.5 10H18M4.3 4.3l1.1 1.1M14.6 14.6l1.1 1.1M4.3 15.7l1.1-1.1M14.6 5.4l1.1-1.1"/>',
  moon: '<path d="M16.5 12A7 7 0 0 1 8 3.5a7 7 0 1 0 8.5 8.5Z"/>',
  refresh: '<path d="M16.5 10A6.5 6.5 0 1 1 14.6 5.4M16.5 3v3.5H13"/>',
  download: '<path d="M10 3v10M6 9.5l4 4 4-4M3.5 16.5h13"/>',
  upload: '<path d="M10 13V3M6 6.5l4-4 4 4M3.5 16.5h13"/>',
  x: '<path d="M5 5l10 10M15 5 5 15"/>',
  check: '<path d="m4.5 10.5 3.5 3.5 7.5-8"/>',
  chevron: '<path d="m6 8 4 4 4-4"/>',
  left: '<path d="m12 5-5 5 5 5"/>',
  right: '<path d="m8 5 5 5-5 5"/>',
  menu: '<path d="M3 5.5h14M3 10h14M3 14.5h14"/>',
  search: '<circle cx="9" cy="9" r="5.5"/><path d="m13 13 4 4"/>',
  trash: '<path d="M3.5 5.5h13M8 5.5V3.5h4v2M5 5.5l.8 11h8.4l.8-11"/>',
  table: '<rect x="2.5" y="3.5" width="15" height="13" rx="1"/><path d="M2.5 8h15M2.5 12.5h15M8 8v8.5"/>',
  plus: '<path d="M10 4v12M4 10h12"/>',
  user: '<circle cx="10" cy="7" r="3.25"/><path d="M3.5 17c.8-3 3.4-4.5 6.5-4.5s5.7 1.5 6.5 4.5"/>',
  external: '<path d="M11 3.5h5.5V9M16.5 3.5 9 11M14 11.5v5H3.5V6h5"/>',
};
export const icon = (name, size = 18) =>
  `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;

export function hydrateIcons(root = document) {
  $$('[data-icon]', root).forEach(el => {
    if (el.dataset.iconDone) return;
    el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon, +(el.dataset.iconSize || 18)));
    el.dataset.iconDone = '1';
  });
}

// ── Toasts ───────────────────────────────────────────────────
export function toast(message, kind = 'info', ms = 3500) {
  let box = $('#toasts');
  if (!box) { box = document.createElement('div'); box.id = 'toasts'; document.body.append(box); }
  const t = document.createElement('div');
  t.className = `toast toast-${kind}`;
  t.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  t.textContent = message;
  box.append(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 250); }, ms);
}

// ── Confirm dialog ───────────────────────────────────────────
export function confirmDialog({ title, body = '', confirm = 'Confirm', danger = false }) {
  return new Promise(resolve => {
    const d = document.createElement('dialog');
    d.className = 'dialog dialog-sm';
    d.innerHTML = `
      <form method="dialog" class="dialog-body">
        <h3 class="dialog-title">${esc(title)}</h3>
        ${body ? `<p class="muted">${esc(body)}</p>` : ''}
        <div class="dialog-actions">
          <button value="cancel" class="btn">Cancel</button>
          <button value="ok" class="btn ${danger ? 'btn-danger' : 'btn-primary'}">${esc(confirm)}</button>
        </div>
      </form>`;
    document.body.append(d);
    d.addEventListener('close', () => { resolve(d.returnValue === 'ok'); d.remove(); });
    d.showModal();
  });
}

// ── Options helper for <select> ──────────────────────────────
export function fillSelect(select, options, { all, keep = true } = {}) {
  const prev = select.value;
  select.innerHTML = (all ? `<option value="${esc(all.value)}">${esc(all.label)}</option>` : '') +
    options.map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join('');
  if (keep && [...select.options].some(o => o.value === prev)) select.value = prev;
}

// ── Theme ────────────────────────────────────────────────────
export function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem('dbmci-theme'); } catch {}
  if (saved === 'dark' || saved === 'light') document.documentElement.dataset.theme = saved;
}
export function isDark() {
  const t = document.documentElement.dataset.theme;
  if (t) return t === 'dark';
  return matchMedia('(prefers-color-scheme: dark)').matches;
}
export function toggleTheme() {
  const next = isDark() ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('dbmci-theme', next); } catch {}
  return next;
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));

// The previous version stored the admin password list and login flags in the
// browser. Remove them from every browser that opens the new version.
export function purgeLegacyStorage() {
  const keys = ['adminCredentials', 'adminLoggedIn', 'adminEmail', 'isSuperAdmin', 'lastActivity',
    'facultyAppreciations', 'pdf_sheetData', 'pdf_facultyData', 'facultyData', 'adminCourses', 'adminCycles', 'adminDays', 'activePage'];
  try { keys.forEach(k => localStorage.removeItem(k)); sessionStorage.removeItem('dbmciAuth'); sessionStorage.removeItem('userEmail'); } catch {}
}
