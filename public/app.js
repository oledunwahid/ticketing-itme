/* ==========================================================================
   IT-ME Ticketing — Frontend SPA (vanilla JS, role-aware, responsive)
   ========================================================================== */
'use strict';

// ---- Domain constants (mirror backend) ----
const STATUSES = ['New', 'Open', 'Assigned', 'On Scheduled', 'On Progress', 'Waiting Sparepart',
  'Waiting Vendor', 'Pending Outlet Response', 'Escalated', 'Resolved', 'Closed', 'Cancelled'];
const URGENCIES = ['Low', 'Medium', 'High', 'Critical'];
const REGIONS = ['Jakarta', 'Surabaya'];
const TECH_STATUSES = ['On Scheduled', 'On Progress', 'Waiting Sparepart', 'Waiting Vendor', 'Pending Outlet Response', 'Escalated', 'Resolved'];
const ADMIN_ROLES = ['SuperAdmin', 'AdminIT', 'AdminME'];
const CAN_CREATE = ['Requestor', 'SuperAdmin', 'AdminIT', 'AdminME'];

const NAV = {
  SuperAdmin: ['dashboard', 'tickets', 'queue', 'schedules', 'reports', 'users', 'categories', 'locations'],
  AdminIT: ['dashboard', 'tickets', 'queue', 'schedules', 'reports', 'users', 'categories', 'locations'],
  AdminME: ['dashboard', 'tickets', 'queue', 'schedules', 'reports', 'categories', 'locations'],
  TechnicianIT: ['tickets', 'categories', 'locations'],
  TechnicianME: ['tickets', 'categories', 'locations'],
  Requestor: ['tickets'],
  Leader: ['dashboard', 'tickets', 'reports'],
};
const NAV_META = {
  dashboard: { label: 'Dashboard', icon: 'grid' },
  tickets: { label: 'Tickets', icon: 'ticket' },
  queue: { label: 'Queue', icon: 'inbox' },
  schedules: { label: 'Schedules', icon: 'calendar' },
  reports: { label: 'Reporting & Performance', icon: 'chart' },
  users: { label: 'Users', icon: 'users' },
  categories: { label: 'Categories', icon: 'tag' },
  locations: { label: 'Locations', icon: 'mapPin' },
};
const ICONS = {
  grid: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
  ticket: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
  inbox: '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  chart: '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/>',
  tag: '<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>',
  mapPin: '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
};

// ---- State ----
const state = {
  user: null,
  route: { name: 'dashboard', id: null },
  meta: { outlets: null, brandsByCode: {} },
};

// ---- DOM shortcuts ----
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const view = () => $('#app-view');

// ---- Helpers ----
function esc(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function stCls(s) { return 'st-' + String(s || '').replace(/\s+/g, ''); }
function badge(status) { return `<span class="badge ${stCls(status)}">${esc(status)}</span>`; }
function urgBadge(u) { return `<span class="badge ur-${esc(u)}">${esc(u)}</span>`; }
function deptTag(d) { return `<span class="dept-tag dept-${esc(d)}">${esc(d)}</span>`; }
function fmtDate(s) {
  if (!s) return '—';
  const d = new Date(s.includes('T') || s.includes('Z') ? s : s.replace(' ', 'T') + 'Z');
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function timeAgo(s) {
  if (!s) return '';
  const d = new Date(s.includes('T') || s.includes('Z') ? s : s.replace(' ', 'T') + 'Z');
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  return `${days}d ago`;
}
function agingClass(t) {
  if (['Closed', 'Cancelled', 'Resolved'].includes(t.status)) return '';
  const d = new Date((t.created_at || '').replace(' ', 'T') + 'Z');
  return (Date.now() - d.getTime()) > 24 * 3600 * 1000 ? 'hot' : '';
}
function fmtBytes(b) { if (!b) return '0 B'; const k = 1024, s = ['B', 'KB', 'MB', 'GB']; const i = Math.floor(Math.log(b) / Math.log(k)); return (b / Math.pow(k, i)).toFixed(1) + ' ' + s[i]; }
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
function svg(paths, size = 20) { return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`; }

// Password field with a show/hide eye toggle. Toggles are wired globally via delegation.
const EYE_ICON = '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/>';
const EYE_OFF_ICON = '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>';
function pwInput(id, attrs = '') {
  return `<div class="pw-wrap"><input type="password" id="${id}" ${attrs}><button type="button" class="pw-toggle" aria-label="Show password" tabindex="-1">${svg(EYE_ICON, 18)}</button></div>`;
}

// ---- Toast ----
function toast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span class="dot"></span><span>${esc(msg)}</span>`;
  $('#toast-container').appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 3600);
}

// ---- API layer ----
class ApiError extends Error { constructor(msg, status) { super(msg); this.status = status; } }
let reauthInFlight = null;

async function rawFetch(url, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (opts.body && !(opts.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const res = await fetch(url, { credentials: 'include', ...opts, headers });
  if (res.status === 401 && !url.includes('/api/auth/')) {
    if (state.user) {
      const ok = await openReauth();
      if (ok) return fetch(url, { credentials: 'include', ...opts, headers });
      throw new ApiError('Session expired', 401);
    }
    state.user = null; renderAuth();
    throw new ApiError('Unauthorized', 401);
  }
  return res;
}
async function apiJSON(url, opts) {
  const res = await rawFetch(url, opts);
  let data = null; try { data = await res.json(); } catch (_) {}
  if (!res.ok) throw new ApiError((data && data.error) || 'Request failed', res.status);
  return data;
}
const api = {
  me: () => apiJSON('/api/auth/me'),
  login: (email, password, remember_me = false) => apiJSON('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password, remember_me }) }),
  logout: () => rawFetch('/api/auth/logout', { method: 'POST' }),
  // Public (no-login) quick-report surface
  publicMeta: () => apiJSON('/api/public/meta'),
  publicQuickReport: (b) => apiJSON('/api/public/quick-report', { method: 'POST', body: JSON.stringify(b) }),
  publicTrack: (num, token) => apiJSON('/api/public/track/' + encodeURIComponent(num) + '?token=' + encodeURIComponent(token)),
  outlets: () => apiJSON('/api/meta/outlets'),
  allOutlets: () => apiJSON('/api/outlets'),
  createOutlet: (b) => apiJSON('/api/outlets', { method: 'POST', body: JSON.stringify(b) }),
  patchOutlet: (id, b) => apiJSON('/api/outlets/' + id, { method: 'PATCH', body: JSON.stringify(b) }),
  deleteOutlet: (id) => apiJSON('/api/outlets/' + id, { method: 'DELETE' }),
  brands: () => apiJSON('/api/meta/brands'),
  categories: (dept) => apiJSON('/api/meta/categories?department=' + encodeURIComponent(dept)),
  allCategories: () => apiJSON('/api/categories'),
  createCategory: (b) => apiJSON('/api/categories', { method: 'POST', body: JSON.stringify(b) }),
  patchCategory: (id, b) => apiJSON('/api/categories/' + id, { method: 'PATCH', body: JSON.stringify(b) }),
  deleteCategory: (id) => apiJSON('/api/categories/' + id, { method: 'DELETE' }),
  tickets: (qs = '') => apiJSON('/api/tickets' + (qs ? '?' + qs : '')),
  ticket: (id) => apiJSON('/api/tickets/' + id),
  createTicket: (b) => apiJSON('/api/tickets', { method: 'POST', body: JSON.stringify(b) }),
  patchTicket: (id, b) => apiJSON('/api/tickets/' + id, { method: 'PATCH', body: JSON.stringify(b) }),
  recommend: (id) => apiJSON('/api/tickets/' + id + '/recommend'),
  assign: (id, b) => apiJSON('/api/tickets/' + id + '/assign', { method: 'POST', body: JSON.stringify(b) }),
  assignToMe: (id) => apiJSON('/api/tickets/' + id + '/assign-to-me', { method: 'POST', body: JSON.stringify({}) }),
  comment: (id, b) => apiJSON('/api/tickets/' + id + '/comments', { method: 'POST', body: JSON.stringify(b) }),
  technicians: (dept) => apiJSON('/api/technicians' + (dept ? '?department=' + dept : '')),
  schedules: (id) => apiJSON('/api/technicians/' + id + '/schedules'),
  addSchedule: (id, b) => apiJSON('/api/technicians/' + id + '/schedules', { method: 'POST', body: JSON.stringify(b) }),
  delSchedule: (id, sid) => apiJSON('/api/technicians/' + id + '/schedules/' + sid, { method: 'DELETE' }),
  addUnavail: (id, b) => apiJSON('/api/technicians/' + id + '/unavailability', { method: 'POST', body: JSON.stringify(b) }),
  delUnavail: (id, uid) => apiJSON('/api/technicians/' + id + '/unavailability/' + uid, { method: 'DELETE' }),
  dashboard: () => apiJSON('/api/dashboard'),
  report: (qs) => apiJSON('/api/reports/tickets' + (qs ? '?' + qs : '')),
  performance: (qs) => apiJSON('/api/reports/performance' + (qs ? '?' + qs : '')),
  users: () => apiJSON('/api/users'),
  createUser: (b) => apiJSON('/api/users', { method: 'POST', body: JSON.stringify(b) }),
  patchUser: (id, b) => apiJSON('/api/users/' + id, { method: 'PATCH', body: JSON.stringify(b) }),
  delUser: (id) => apiJSON('/api/users/' + id, { method: 'DELETE' }),
  changePassword: (b) => apiJSON('/api/auth/change-password', { method: 'POST', body: JSON.stringify(b) }),
};

async function loadOutlets() {
  if (state.meta.outlets) return state.meta.outlets;
  state.meta.outlets = await api.outlets();
  return state.meta.outlets;
}

// ==========================================================================
// Modal system
// ==========================================================================
function openModal({ title, bodyHTML, footHTML, onMount, size }) {
  const root = $('#modal-root');
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" style="${size === 'lg' ? 'max-width:720px' : ''}" role="dialog" aria-modal="true">
      <div class="modal-head"><h3>${esc(title)}</h3><button class="modal-close" aria-label="Close">&times;</button></div>
      <div class="modal-body">${bodyHTML}</div>
      ${footHTML ? `<div class="modal-foot">${footHTML}</div>` : ''}
    </div>`;
  root.appendChild(overlay);
  const prevFocus = document.activeElement;
  const onKey = (e) => {
    if (e.key === 'Escape') { close(); return; }
    if (e.key === 'Tab') trapFocus(e, overlay);
  };
  const close = () => {
    document.removeEventListener('keydown', onKey);
    overlay.remove();
    if (prevFocus && prevFocus.focus) prevFocus.focus();
  };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  $('.modal-close', overlay).addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  if (onMount) onMount(overlay, close);
  // Focus the first sensible control (respect autofocus, else first field/button)
  const first = $('[autofocus]', overlay) || $('input, select, textarea', overlay) || $('.modal-close', overlay);
  if (first) setTimeout(() => first.focus(), 20);
  return { overlay, close };
}

// Image lightbox — opens an image attachment as an in-app preview overlay
// instead of a raw browser tab. Bound once (below) via event delegation so it
// works for images in the activity timeline and the Evidence panel alike, and
// survives re-renders.
function openImagePreview(url, name) {
  const root = $('#modal-root');
  const overlay = document.createElement('div');
  overlay.className = 'lightbox-overlay';
  overlay.innerHTML = `
    <div class="lightbox">
      <div class="lightbox-bar">
        <span class="lightbox-name">${esc(name || 'Preview')}</span>
        <a class="lightbox-btn" href="${esc(url)}" target="_blank" title="Open in new tab" aria-label="Open in new tab">↗</a>
        <button class="lightbox-btn lightbox-close" aria-label="Close">&times;</button>
      </div>
      <img class="lightbox-img" src="${esc(url)}" alt="${esc(name || '')}">
    </div>`;
  root.appendChild(overlay);
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const close = () => { document.removeEventListener('keydown', onKey); overlay.remove(); };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  $('.lightbox-close', overlay).addEventListener('click', close);
  document.addEventListener('keydown', onKey);
}
document.addEventListener('click', (e) => {
  const link = e.target.closest && e.target.closest('a[data-preview]');
  if (!link) return;
  // Respect modifier/middle clicks — let them open in a new tab as usual.
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  openImagePreview(link.getAttribute('data-preview'), link.getAttribute('data-preview-name'));
});

// Keep Tab focus cycling inside the open modal
function trapFocus(e, overlay) {
  const f = $$('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])', overlay)
    .filter((el) => el.offsetParent !== null);
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

// Generic form modal → resolves with values object or null
function formModal(title, fields, submitLabel = 'Save') {
  return new Promise((resolve) => {
    const body = fields.map((f) => {
      const id = 'fm_' + f.name;
      let input;
      if (f.type === 'textarea') input = `<textarea id="${id}" rows="${f.rows || 3}" placeholder="${esc(f.placeholder || '')}">${esc(f.value || '')}</textarea>`;
      else if (f.type === 'select') input = `<select id="${id}">${f.options.map((o) => `<option value="${esc(o.value)}" ${o.value === f.value ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
      else if (f.type === 'multiselect') {
        const sel = Array.isArray(f.value) ? f.value : [];
        input = `<div class="multiselect-box" id="${id}">${f.options.length ? f.options.map((o) => `<label class="ms-opt"><input type="checkbox" value="${esc(o.value)}" ${sel.includes(o.value) ? 'checked' : ''}> ${esc(o.label)}</label>`).join('') : '<span class="muted">No options</span>'}</div>`;
      }
      else if (f.type === 'checkbox') input = `<label class="row gap-sm" style="cursor:pointer"><input type="checkbox" id="${id}" ${f.value ? 'checked' : ''} style="width:auto"> ${esc(f.checkboxLabel || '')}</label>`;
      else if (f.type === 'password') input = pwInput(id, `value="${esc(f.value || '')}" placeholder="${esc(f.placeholder || '')}"`);
      else input = `<input type="${f.type || 'text'}" id="${id}" value="${esc(f.value || '')}" placeholder="${esc(f.placeholder || '')}">`;
      return `<div class="field">${f.type === 'checkbox' ? '' : `<label for="${id}">${esc(f.label)}${f.required ? ' <span class="req-star">*</span>' : ''}</label>`}${input}${f.hint ? `<div class="hint">${esc(f.hint)}</div>` : ''}</div>`;
    }).join('');
    const foot = `<button class="btn-ghost" data-cancel>Cancel</button><button class="btn-primary" data-ok>${esc(submitLabel)}</button>`;
    const { overlay, close } = openModal({
      title, bodyHTML: body, footHTML: foot,
      onMount(ov) {
        $('[data-cancel]', ov).addEventListener('click', () => { close(); resolve(null); });
        $('[data-ok]', ov).addEventListener('click', () => {
          const vals = {};
          for (const f of fields) {
            const el = $('#fm_' + f.name, ov);
            if (f.type === 'checkbox') vals[f.name] = el.checked;
            else if (f.type === 'multiselect') vals[f.name] = $$('input[type=checkbox]', el).filter((c) => c.checked).map((c) => c.value);
            else vals[f.name] = el.value.trim();
            if (f.required && (f.type === 'multiselect' ? !vals[f.name].length : !vals[f.name])) { toast(`${f.label} is required`, 'error'); el.focus && el.focus(); return; }
          }
          close(); resolve(vals);
        });
      },
    });
  });
}

// Re-auth modal (session expiry mid-action)
function openReauth() {
  if (reauthInFlight) return reauthInFlight;
  reauthInFlight = new Promise((resolve) => {
    const { overlay, close } = openModal({
      title: 'Session expired',
      bodyHTML: `<p class="muted mb">Please re-enter your password to continue.</p>
        <div class="field"><label>Email</label><input value="${esc(state.user ? state.user.email : '')}" disabled></div>
        <div class="field"><label>Password</label>${pwInput('reauth-pw', 'autofocus')}</div>`,
      footHTML: `<button class="btn-ghost" data-out>Sign out</button><button class="btn-primary" data-go>Confirm</button>`,
      onMount(ov) {
        const finish = (val) => { close(); reauthInFlight = null; resolve(val); };
        $('[data-out]', ov).addEventListener('click', async () => { finish(false); await doLogout(); });
        $('[data-go]', ov).addEventListener('click', async () => {
          const pw = $('#reauth-pw', ov).value;
          try { await api.login(state.user.email, pw); toast('Session restored', 'success'); finish(true); }
          catch (e) { toast('Wrong password', 'error'); }
        });
      },
    });
  });
  return reauthInFlight;
}

// ==========================================================================
// Attachment uploader (direct + chunked for video)
// ==========================================================================
class Uploader {
  constructor(zone, list) {
    this.zone = zone; this.list = list; this.items = [];
    this.chunkSize = 2 * 1024 * 1024;
    const input = $('input[type=file]', zone);
    zone.addEventListener('click', (e) => {
      if (e.target.closest('.preview-card')) return;
      // The file input is an invisible overlay (position:absolute; inset:0) covering the
      // whole zone, so a click on it already opens the picker natively. Only trigger it
      // programmatically for clicks that did NOT land on the input — otherwise the picker
      // opens twice (native + programmatic).
      if (e.target === input) return;
      input.click();
    });
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('dragover'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('dragover'); this.add(e.dataTransfer.files); });
    input.addEventListener('change', (e) => { this.add(e.target.files); input.value = ''; });
  }
  add(files) {
    for (const file of files) {
      if (this.items.length >= 5) { toast('Max 5 files', 'error'); return; }
      const isImg = file.type.startsWith('image/'), isVid = file.type.startsWith('video/');
      if (!isImg && !isVid) { toast('Unsupported: ' + file.name, 'error'); continue; }
      if (isImg && file.size > 10 * 1024 * 1024) { toast('Image > 10MB: ' + file.name, 'error'); continue; }
      if (isVid && file.size > 100 * 1024 * 1024) { toast('Video > 100MB: ' + file.name, 'error'); continue; }
      const it = { uid: Math.random().toString(36).slice(2), file, name: file.name, size: file.size, type: file.type, id: null, state: 'uploading', xhr: null };
      this.items.push(it); this.renderItem(it); this.start(it);
    }
  }
  renderItem(it) {
    const card = document.createElement('div');
    card.className = 'preview-card'; card.id = 'pc_' + it.uid;
    card.innerHTML = `<button class="pc-remove" title="Remove">&times;</button>
      ${it.type.startsWith('image/') ? '<img alt="">' : svg('<polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/>', 24)}
      <div class="pc-name" title="${esc(it.name)}">${esc(it.name)}</div>
      <div class="pc-size">${fmtBytes(it.size)}</div>
      <div class="pc-progress"><div class="pc-bar"></div></div>
      <div class="pc-err" hidden></div>`;
    if (it.type.startsWith('image/')) { const r = new FileReader(); r.onload = (e) => { const im = $('img', card); if (im) im.src = e.target.result; }; r.readAsDataURL(it.file); }
    $('.pc-remove', card).addEventListener('click', (e) => { e.stopPropagation(); this.remove(it); });
    this.list.appendChild(card);
  }
  bar(it) { const c = $('#pc_' + it.uid, this.list); return c ? $('.pc-bar', c) : null; }
  setErr(it, msg) {
    it.state = 'error'; const c = $('#pc_' + it.uid, this.list); if (!c) return;
    const e = $('.pc-err', c); e.hidden = false; e.innerHTML = `${esc(msg)} <button class="pc-retry">Retry</button>`;
    $('.pc-retry', e).addEventListener('click', (ev) => { ev.stopPropagation(); e.hidden = true; it.state = 'uploading'; this.start(it); });
  }
  start(it) { it.type.startsWith('video/') ? this.chunked(it) : this.direct(it); }
  direct(it) {
    const xhr = new XMLHttpRequest(); it.xhr = xhr;
    xhr.open('POST', '/api/attachments/upload');
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) { const b = this.bar(it); if (b) b.style.width = Math.round(e.loaded / e.total * 100) + '%'; } };
    xhr.onload = () => { if (xhr.status === 201) { it.id = JSON.parse(xhr.responseText).id; it.state = 'done'; } else { this.setErr(it, this.err(xhr)); } };
    xhr.onerror = () => this.setErr(it, 'Network error');
    const fd = new FormData(); fd.append('file', it.file); xhr.send(fd);
  }
  chunked(it) {
    const total = Math.ceil(it.size / this.chunkSize); it.total = total; it.idx = 0;
    const next = () => {
      if (it.state === 'error') return;
      const start = it.idx * this.chunkSize, end = Math.min(start + this.chunkSize, it.size);
      const xhr = new XMLHttpRequest(); it.xhr = xhr;
      xhr.open('POST', '/api/attachments/upload-chunk');
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) { const b = this.bar(it); if (b) b.style.width = Math.min(99, Math.round((it.idx + e.loaded / e.total) / total * 100)) + '%'; } };
      xhr.onload = () => {
        if (xhr.status === 200 || xhr.status === 201) {
          it.idx++;
          if (it.idx < total) next();
          else { it.id = JSON.parse(xhr.responseText).id; it.state = 'done'; const b = this.bar(it); if (b) b.style.width = '100%'; }
        } else this.setErr(it, this.err(xhr));
      };
      xhr.onerror = () => this.setErr(it, 'Network error');
      const fd = new FormData();
      fd.append('fileId', it.uid); fd.append('chunkIndex', it.idx); fd.append('totalChunks', total);
      fd.append('fileName', it.name); fd.append('mimeType', it.type); fd.append('fileSize', it.size);
      fd.append('chunk', it.file.slice(start, end), it.name);
      xhr.send(fd);
    };
    next();
  }
  err(xhr) { try { return JSON.parse(xhr.responseText).error; } catch (_) { return 'Upload failed'; } }
  remove(it) { if (it.xhr) it.xhr.abort(); if (it.id) rawFetch('/api/attachments/' + it.id, { method: 'DELETE' }).catch(() => {}); this.items = this.items.filter((x) => x !== it); const c = $('#pc_' + it.uid, this.list); if (c) c.remove(); }
  uploading() { return this.items.some((i) => i.state === 'uploading'); }
  ids() { return this.items.filter((i) => i.state === 'done').map((i) => i.id); }
  clear() { this.items.forEach((i) => { if (i.xhr) i.xhr.abort(); }); this.items = []; this.list.innerHTML = ''; }
}
function uploadZoneHTML(id) {
  return `<div class="upload-zone" id="${id}">
    <input type="file" multiple accept="image/*,video/mp4,video/webm,video/quicktime">
    ${svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>', 26)}
    <p>Tap to add or drop photos/videos</p>
    <p class="hint">Images &lt;10MB · Videos &lt;100MB · max 5</p>
  </div><div class="preview-list" id="${id}-list"></div>`;
}

// ==========================================================================
// Auth screens
// ==========================================================================
function renderAuth() {
  $('#app-shell').hidden = true;
  const root = $('#auth-root'); root.hidden = false;
  root.innerHTML = `
    <form class="auth-card" id="login-form">
      <div class="auth-brand"><div class="brand-mark">IM</div><span class="brand-text">IT-ME Ticketing</span></div>
      <div class="auth-title">Sign in</div>
      <div class="auth-sub">Report & track operational issues</div>
      <div class="field"><label>Email</label><input type="email" id="li-email" required autocomplete="username"></div>
      <div class="field"><label>Password</label>${pwInput('li-pw', 'required autocomplete="current-password"')}</div>
      <label class="remember-row"><input type="checkbox" id="li-remember"><span>Remember me on this device</span></label>
      <button class="btn-primary btn-block" id="li-submit">Sign in</button>
    </form>`;
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#li-submit'); btn.disabled = true; btn.textContent = 'Signing in…';
    try {
      state.user = await api.login($('#li-email').value.trim(), $('#li-pw').value, $('#li-remember').checked);
      const p = new URLSearchParams(location.search).get('redirect');
      boot(); navigate(p || defaultRoute());
    } catch (err) { toast(err.message || 'Login failed', 'error'); btn.disabled = false; btn.textContent = 'Sign in'; }
  });
}

// ==========================================================================
// Public Quick Report (no login) — only creates a New ticket
// ==========================================================================
async function renderPublicQuickReport() {
  $('#app-shell').hidden = true;
  const root = $('#auth-root'); root.hidden = false;
  root.innerHTML = `<div class="auth-card public-card" id="pq-card"><div class="loading-inline">Memuat formulir…</div></div>`;
  let meta;
  try { meta = await api.publicMeta(); }
  catch (e) { $('#pq-card').innerHTML = `<div class="auth-brand"><div class="brand-mark">IM</div><span class="brand-text">IT-ME Ticketing</span></div><h3>Gagal memuat formulir</h3><p class="muted">${esc(e.message || 'Coba lagi.')}</p><a href="/login" data-nav class="btn-outline btn-block mt">← Kembali ke login</a>`; wireNavLinks(); return; }

  const groups = {};
  (meta.outlets || []).forEach((o) => { (groups[o.brand_code] = groups[o.brand_code] || []).push(o); });
  const optgroups = Object.entries(groups).map(([b, list]) => `<optgroup label="${esc(b)}">${list.map((o) => `<option value="${esc(o.code)}">${esc(o.code)}${o.region ? ' · ' + esc(o.region) : ''}</option>`).join('')}</optgroup>`).join('');

  $('#pq-card').innerHTML = `
    <div class="auth-brand"><div class="brand-mark">IM</div><span class="brand-text">IT-ME Ticketing</span></div>
    <div class="auth-title">Quick Report</div>
    <div class="auth-sub">Laporkan kendala tanpa perlu login</div>
    <div class="field"><label>Outlet <span class="req-star">*</span></label><select id="pq-outlet"><option value="">Pilih outlet…</option>${optgroups}</select></div>
    <div class="field"><label>Departemen <span class="req-star">*</span></label>
      <div class="segmented"><button type="button" class="seg-btn big" data-pqdept="IT">🖥️ IT</button><button type="button" class="seg-btn big" data-pqdept="ME">🔧 Mechanical</button></div></div>
    <div class="field"><label>Kategori <span class="req-star">*</span></label><select id="pq-cat" disabled><option>Pilih departemen dulu</option></select></div>
    <div class="field"><label>Deskripsi masalah <span class="req-star">*</span></label><textarea id="pq-desc" placeholder="mis. printer kasir 2 tidak keluar struk"></textarea></div>
    <div class="field-row">
      <div class="field"><label>Nama pelapor <span class="req-star">*</span></label><input id="pq-name" placeholder="Nama Anda"></div>
      <div class="field"><label>WhatsApp / kontak <span class="req-star">*</span></label><input id="pq-contact" placeholder="08xx…" inputmode="tel"></div>
    </div>
    <div class="field"><label>Urgensi (opsional)</label><div class="segmented" id="pq-urg">${URGENCIES.map((u) => `<button type="button" class="seg-btn ${u === 'Medium' ? 'active' : ''}" data-pqurg="${u}">${u}</button>`).join('')}</div></div>
    <div class="field"><label>Lokasi di dalam outlet (opsional)</label><input id="pq-loc" placeholder="mis. area kasir depan"></div>
    <div class="field"><label>Foto / video (opsional)</label>
      <input type="file" id="pq-file" accept="image/*,video/*" multiple>
      <div class="pq-uploads" id="pq-uplist"></div>
    </div>
    <button type="button" class="btn-primary btn-block" id="pq-submit">Kirim laporan</button>
    <a href="/login" data-nav class="auth-switch" style="display:block;text-align:center">← Kembali ke login</a>`;
  wireNavLinks();

  let dept = '';
  $$('[data-pqdept]').forEach((b) => b.addEventListener('click', () => {
    dept = b.dataset.pqdept;
    $$('[data-pqdept]').forEach((x) => x.classList.toggle('active', x === b));
    const sel = $('#pq-cat'); const list = (meta.categories && meta.categories[dept]) || [];
    sel.innerHTML = '<option value="">Pilih kategori…</option>' + list.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    sel.disabled = false;
  }));
  let urg = 'Medium';
  $$('[data-pqurg]').forEach((b) => b.addEventListener('click', () => { urg = b.dataset.pqurg; $$('[data-pqurg]').forEach((x) => x.classList.toggle('active', x === b)); }));

  // Lightweight public uploader — posts each file to /api/public/upload.
  const uploadedIds = [];
  let uploading = 0;
  $('#pq-file').addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    for (const f of files) {
      if (uploadedIds.length >= 5) { toast('Maksimal 5 file', 'error'); break; }
      const row = document.createElement('div'); row.className = 'pq-uprow'; row.textContent = '⏳ ' + f.name;
      $('#pq-uplist').appendChild(row);
      uploading++;
      try {
        const fd = new FormData(); fd.append('file', f);
        const res = await rawFetch('/api/public/upload', { method: 'POST', body: fd });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Upload gagal');
        uploadedIds.push(data.id); row.textContent = '✓ ' + f.name;
      } catch (err) { row.textContent = '✕ ' + f.name + ' — ' + err.message; row.classList.add('err'); toast(err.message, 'error'); }
      finally { uploading--; }
    }
  });

  const submit = $('#pq-submit');
  let submitted = false;
  submit.addEventListener('click', async () => {
    if (submitted) return;
    const outlet = $('#pq-outlet').value, cat = $('#pq-cat').value, desc = $('#pq-desc').value.trim();
    const name = $('#pq-name').value.trim(), contact = $('#pq-contact').value.trim();
    if (!outlet) return toast('Pilih outlet', 'error');
    if (!dept) return toast('Pilih IT atau Mechanical', 'error');
    if (!cat) return toast('Pilih kategori', 'error');
    if (!desc) return toast('Isi deskripsi masalah', 'error');
    if (!name) return toast('Isi nama pelapor', 'error');
    if (!contact) return toast('Isi nomor WhatsApp / kontak', 'error');
    if (uploading > 0) return toast('Tunggu unggahan selesai', 'error');
    submitted = true; submit.disabled = true; submit.textContent = 'Mengirim…';
    try {
      const r = await api.publicQuickReport({
        department: dept, outlet_code: outlet, category: cat, description: desc,
        reporter_name: name, contact_number: contact, urgency: urg,
        location_detail: $('#pq-loc').value.trim(), attachmentIds: uploadedIds,
      });
      renderPublicSuccess(r);
    } catch (e) {
      submitted = false; submit.disabled = false; submit.textContent = 'Kirim laporan';
      toast(e.message || 'Gagal mengirim', 'error');
    }
  });
}

function renderPublicSuccess(r) {
  const trackUrl = location.origin + (r.track_url || '');
  $('#pq-card').innerHTML = `
    <div class="auth-brand"><div class="brand-mark">IM</div><span class="brand-text">IT-ME Ticketing</span></div>
    <div class="pq-success">
      <div class="pq-check">✓</div>
      <h3>Ticket ${esc(r.ticket_number)} berhasil dibuat</h3>
      <p class="muted">Tim terkait akan menindaklanjuti laporan Anda.</p>
      <div class="pq-ticketno">${esc(r.ticket_number)}</div>
      ${r.tracking_token ? `<label class="hint" style="margin-top:12px">Simpan link untuk melacak status:</label>
      <div class="pq-track"><input id="pq-trackurl" readonly value="${esc(trackUrl)}"><button class="btn-outline" id="pq-copy">Salin</button></div>` : ''}
      <div class="row gap-sm mt" style="justify-content:center">
        <a href="/quick-report" data-nav class="btn-outline">Laporan baru</a>
        <a href="/login" data-nav class="btn-ghost">Login</a>
      </div>
    </div>`;
  wireNavLinks();
  const copyBtn = $('#pq-copy');
  if (copyBtn) copyBtn.addEventListener('click', () => {
    const inp = $('#pq-trackurl'); inp.select();
    try { navigator.clipboard.writeText(inp.value); toast('Link disalin', 'success'); }
    catch (_) { document.execCommand('copy'); toast('Link disalin', 'success'); }
  });
}

// ==========================================================================
// Public ticket tracking (token-gated, public-safe fields only)
// ==========================================================================
async function renderPublicTrack(ticketNumber) {
  $('#app-shell').hidden = true;
  const root = $('#auth-root'); root.hidden = false;
  const token = new URLSearchParams(location.search).get('token') || '';
  root.innerHTML = `<div class="auth-card public-card" id="pt-card"><div class="loading-inline">Melacak tiket…</div></div>`;
  if (!ticketNumber || !token) {
    $('#pt-card').innerHTML = `<div class="auth-brand"><div class="brand-mark">IM</div><span class="brand-text">IT-ME Ticketing</span></div><h3>Link pelacakan tidak valid</h3><p class="muted">Token pelacakan diperlukan.</p><a href="/login" data-nav class="btn-outline btn-block mt">← Ke login</a>`;
    wireNavLinks(); return;
  }
  try {
    const t = await api.publicTrack(ticketNumber, token);
    $('#pt-card').innerHTML = `
      <div class="auth-brand"><div class="brand-mark">IM</div><span class="brand-text">IT-ME Ticketing</span></div>
      <div class="auth-title">Status Tiket</div>
      <div class="pq-ticketno" style="margin:10px 0">${esc(t.ticket_number)}</div>
      <dl class="info-list">
        <dt>Status</dt><dd>${badge(t.status)}</dd>
        <dt>Departemen</dt><dd>${deptTag(t.department)}</dd>
        <dt>Outlet</dt><dd>${esc(t.outlet || '—')}${t.region ? ' · ' + esc(t.region) : ''}</dd>
        <dt>Dibuat</dt><dd>${fmtDate(t.created_at)}</dd>
        <dt>Update terakhir</dt><dd>${fmtDate(t.last_update_at)}</dd>
      </dl>
      <a href="/quick-report" data-nav class="btn-outline btn-block mt">Buat laporan baru</a>`;
    wireNavLinks();
  } catch (e) {
    $('#pt-card').innerHTML = `<div class="auth-brand"><div class="brand-mark">IM</div><span class="brand-text">IT-ME Ticketing</span></div><h3>Tiket tidak ditemukan</h3><p class="muted">${esc(e.message || 'Token tidak valid.')}</p><a href="/login" data-nav class="btn-outline btn-block mt">← Ke login</a>`;
    wireNavLinks();
  }
}

// ==========================================================================
// Shell / navigation
// ==========================================================================
function defaultRoute() {
  const r = state.user.role;
  if (r === 'Requestor' || r === 'TechnicianIT' || r === 'TechnicianME') return '/tickets';
  return '/dashboard';
}
function boot() {
  $('#auth-root').hidden = true;
  $('#app-shell').hidden = false;
  const u = state.user;
  $('#user-avatar').textContent = (u.username || '?').charAt(0).toUpperCase();
  $('#user-name').textContent = u.username;
  $('#user-role').textContent = u.role;
  $('#btn-report-quick').style.display = CAN_CREATE.includes(u.role) ? '' : 'none';
  renderNav();
}
function renderNav() {
  const keys = NAV[state.user.role] || ['tickets'];
  const items = keys.map((k) => `<button class="nav-item" data-route="${k}">${svg(ICONS[NAV_META[k].icon], 19)}<span>${navLabel(k)}</span></button>`).join('');
  $('#nav-menu').innerHTML = items;
  $('#bottom-nav').innerHTML = keys.slice(0, 5).map((k) => `<button class="bn-item" data-route="${k}">${svg(ICONS[NAV_META[k].icon], 21)}<span>${navLabel(k)}</span></button>`).join('');
  $$('[data-route]').forEach((b) => b.addEventListener('click', () => { navigate('/' + b.dataset.route); closeDrawer(); }));
}
function navLabel(k) {
  if (k === 'tickets' && (state.user.role === 'Requestor')) return 'My Tickets';
  if (k === 'tickets' && (state.user.role.startsWith('Technician'))) return 'My Jobs';
  return NAV_META[k].label;
}
function setActiveNav(name) {
  $$('.nav-item, .bn-item').forEach((b) => {
    const on = b.dataset.route === name;
    b.classList.toggle('active', on);
    if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  $('#page-title').textContent = name === 'tickets' ? navLabel('tickets') : (NAV_META[name] ? NAV_META[name].label : 'Ticket');
}
function openDrawer() { $('#app-shell').classList.add('drawer-open'); $('#drawer-overlay').hidden = false; }
function closeDrawer() { $('#app-shell').classList.remove('drawer-open'); $('#drawer-overlay').hidden = true; }

// ==========================================================================
// Router
// ==========================================================================
function navigate(path) { history.pushState(null, '', path); route(); }
window.addEventListener('popstate', route);

async function route() {
  const path = location.pathname;
  const parts = path.split('/').filter(Boolean);
  // --- Public (no-login) routes — reachable whether or not signed in ---
  if (parts[0] === 'quick-report' || parts[0] === 'report') return renderPublicQuickReport();
  if (parts[0] === 'track') return renderPublicTrack(parts[1] || '');
  if (!state.user) {
    // Public register is removed — send any /register hit to the login screen.
    if (path === '/register') history.replaceState(null, '', '/login');
    return renderAuth();
  }
  let name = parts[0] || defaultRoute().slice(1);
  const id = parts[1] || null;

  // RBAC route guard (mirror backend; backend is source of truth)
  const allowed = NAV[state.user.role] || [];
  if (name === 'tickets' && id) { state.route = { name: 'ticket', id }; setActiveNav('tickets'); animateViewIn(); return renderTicketDetail(id); }
  if (!allowed.includes(name) && !['ticket'].includes(name)) {
    if (name === 'categories' || name === 'locations') {
      state.route = { name: name, id: null };
      setActiveNav(name);
      animateViewIn();
      renderAccessDenied();
      return;
    }
    return navigate(defaultRoute());
  }
  state.route = { name, id };
  setActiveNav(name);
  animateViewIn();
  const map = {
    dashboard: renderDashboard,
    tickets: renderTickets,
    queue: renderQueue,
    schedules: renderSchedules,
    reports: renderReports,
    users: renderUsers,
    categories: renderCategories,
    locations: renderLocations
  };
  (map[name] || renderDashboard)();
}

function renderAccessDenied() {
  $('#page-title').textContent = 'Access Denied';
  view().innerHTML = `
    <div class="empty">
      <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="var(--danger)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:var(--danger);margin-bottom:16px">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
        <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
      </svg>
      <h3 style="color:var(--danger);font-size:1.35rem;margin-bottom:8px">Access Denied</h3>
      <p class="muted" style="max-width:380px;margin:0 auto 20px">You do not have the required permissions to access the Category Creation Menu.</p>
      <button class="btn-primary" id="btn-denied-home">Go to Tickets</button>
    </div>`;
  $('#btn-denied-home').addEventListener('click', () => navigate('/tickets'));
}

// Retrigger the entrance animation on the view container each route change
function animateViewIn() {
  const v = view();
  v.classList.remove('view-anim');
  void v.offsetWidth; // reflow so the animation restarts
  v.classList.add('view-anim');
}

// ==========================================================================
// View: Dashboard
// ==========================================================================
async function renderDashboard() {
  view().innerHTML = `<div class="page-head"><h2>Dashboard</h2><p>Live operational overview</p></div>
    <div class="stat-grid" id="d-stats">${skeletonStats()}</div><div id="d-rest"></div>`;
  try {
    const d = await api.dashboard();
    const T = d.totals;
    $('#d-stats').innerHTML = `
      ${statCard(T.total, 'Total tickets', 'primary')}
      ${statCard(T.open, 'Open', 'warn')}
      ${statCard(T.unassigned, 'Unassigned', 'danger')}
      ${statCard(T.on_scheduled || 0, 'On Scheduled')}
      ${statCard(T.waiting, 'Waiting parts/vendor')}
      ${statCard(d.avg_resolution_hours != null ? d.avg_resolution_hours + 'h' : '—', 'Avg resolution', 'ok')}`;
    animateCounters($('#d-stats'));
    const distMax = Math.max(1, ...d.byStatus.map((s) => s.c));
    // Dashboard stays glanceable: a compact SLA snapshot only. The full SLA/KPI
    // analysis, technician performance and manager insights live in the
    // Reporting & Performance module (link below).
    const canReport = ['SuperAdmin', 'AdminIT', 'AdminME', 'Leader'].includes(state.user.role);
    const kpiSection = canReport ? `
      <div class="panel mt"><div class="panel-head"><h3>SLA snapshot ${state.user.role !== 'SuperAdmin' ? '<span class="muted" style="font-weight:400">(your department)</span>' : ''}</h3>
        <button class="btn-outline" id="d-goreport" style="padding:6px 12px">Open Reporting &amp; Performance →</button></div>
        <div class="stat-grid">
          ${statCard(d.sla.met, 'SLA met', 'ok')}
          ${statCard(d.sla.breached, 'SLA breached', 'danger')}
          ${statCard(d.sla.achievement != null ? d.sla.achievement + '%' : '—', 'SLA achievement', 'primary')}
          ${statCard(d.avg_resolution_hours != null ? d.avg_resolution_hours + 'h' : '—', 'Avg resolution', 'ok')}
        </div>
        <div class="hint" style="padding:0 4px 4px">Full technician rankings, outlet/region analysis, SLA detail &amp; manager insights → Reporting &amp; Performance.</div>
      </div>` : '';
    $('#d-rest').innerHTML = `
      <div class="grid-2">
        <div class="panel"><div class="panel-head"><h3>By status</h3></div><div class="card" style="border:none">
          ${d.byStatus.length ? d.byStatus.map((s) => `<div class="dist-row"><span>${badge(s.status)}</span><div class="row" style="flex:1;margin:0 12px"><div class="dist-bar ${stCls(s.status)}" style="width:${Math.round(s.c / distMax * 100)}%;background:currentColor;opacity:.5"></div></div><strong>${s.c}</strong></div>`).join('') : '<p class="muted">No data</p>'}
        </div></div>
        <div class="panel"><div class="panel-head"><h3>By department</h3></div><div class="card" style="border:none">
          ${d.byDept.filter((x) => x.department).map((s) => `<div class="dist-row"><span>${deptTag(s.department)}</span><strong>${s.c}</strong></div>`).join('') || '<p class="muted">No data</p>'}
          <div class="divider"></div><h3 style="font-size:.85rem;margin-bottom:6px">By region</h3>
          ${(d.byRegion || []).filter((x) => x.region).map((s) => `<div class="dist-row"><span>${esc(s.region)}</span><strong>${s.c}</strong></div>`).join('') || '<p class="muted">No data</p>'}
          <div class="divider"></div><h3 style="font-size:.85rem;margin-bottom:6px">Top outlets</h3>
          ${d.byOutlet.filter((x) => x.outlet_code).slice(0, 6).map((s) => `<div class="dist-row"><span>${esc(s.outlet_code)}</span><strong>${s.c}</strong></div>`).join('') || '<p class="muted">No data</p>'}
        </div></div>
      </div>
      ${kpiSection}
      <div class="grid-2 mt">
        <div class="panel"><div class="panel-head"><h3>Recurring categories</h3></div><div class="card" style="border:none">
          ${d.topCategories.length ? d.topCategories.map((c) => `<div class="dist-row"><span>${deptTag(c.department)} ${esc(c.category)}</span><strong>${c.c}</strong></div>`).join('') : '<p class="muted">No data</p>'}
        </div></div>
        ${d.workload && d.workload.length ? `<div class="panel"><div class="panel-head"><h3>Technician workload</h3></div><div class="card" style="border:none">
          ${d.workload.map((w) => `<div class="dist-row"><span>${esc(w.technician)} ${deptTag(w.department)}</span><strong>${w.open} open</strong></div>`).join('')}
        </div></div>` : (d.byTechnician && d.byTechnician.length ? `<div class="panel"><div class="panel-head"><h3>Tickets by technician</h3></div><div class="card" style="border:none">
          ${d.byTechnician.map((w) => `<div class="dist-row"><span>${esc(w.assignee_name)}</span><strong>${w.c}</strong></div>`).join('')}
        </div></div>` : '')}
      </div>`;
    animateCounters($('#d-rest'));
    const goRep = $('#d-goreport'); if (goRep) goRep.addEventListener('click', () => navigate('/reports'));
  } catch (e) { $('#d-rest').innerHTML = errBox(e); }
}
function statCard(n, l, accent) { return `<div class="stat ${accent ? 'accent-' + accent : ''}"><span class="n">${esc(n)}</span><span class="l">${esc(l)}</span></div>`; }
// Count-up animation for numeric stat values (preserves any suffix like "h")
function animateCounters(root) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  $$('.stat .n', root).forEach((el) => {
    const m = /^(\d+)(.*)$/.exec(el.textContent.trim());
    if (!m) return;
    const target = Number(m[1]), suffix = m[2] || '';
    if (target <= 0) return;
    const dur = 650, t0 = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - t0) / dur);
      const eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
      el.textContent = Math.round(target * eased) + suffix;
      if (p < 1) requestAnimationFrame(step);
    };
    el.textContent = '0' + suffix;
    requestAnimationFrame(step);
  });
}
function skeletonStats() { return Array(5).fill('<div class="stat"><span class="n">—</span><span class="l">Loading…</span></div>').join(''); }

// ==========================================================================
// View: Tickets list
// ==========================================================================
// scope = technician PIC filter; sort = created_asc (default) | created_desc | urgency
const listFilters = { status: '', urgency: '', department: '', region: '', search: '', scope: '', sort: '' };
const TECH_SCOPES = [
  { value: '', label: 'My PIC outlets' },
  { value: 'mine', label: 'Assigned to me' },
  { value: 'unassigned_pic', label: 'Unassigned in my PIC' },
  { value: 'all', label: 'All allowed tickets' },
];
async function renderTickets() {
  const showDept = ['SuperAdmin', 'Leader'].includes(state.user.role);
  const showRegion = ['SuperAdmin', 'AdminIT', 'AdminME', 'Leader'].includes(state.user.role);
  const isTech = state.user.role.startsWith('Technician');
  view().innerHTML = `
    <div class="page-head"><h2>${navLabel('tickets')}</h2><p>${ticketsSubtitle()}</p></div>
    <div class="toolbar">
      <div class="search"><input id="f-search" placeholder="Search subject, #, requester…" value="${esc(listFilters.search)}"></div>
      ${isTech ? `<select id="f-scope">${TECH_SCOPES.map((s) => `<option value="${s.value}" ${listFilters.scope === s.value ? 'selected' : ''}>${s.label}</option>`).join('')}</select>` : ''}
      <select id="f-status"><option value="">All statuses</option>${STATUSES.map((s) => `<option ${listFilters.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
      <select id="f-urg"><option value="">All urgency</option>${URGENCIES.map((s) => `<option ${listFilters.urgency === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
      ${showDept ? `<select id="f-dept"><option value="">All depts</option><option ${listFilters.department === 'IT' ? 'selected' : ''}>IT</option><option ${listFilters.department === 'ME' ? 'selected' : ''}>ME</option></select>` : ''}
      ${showRegion ? `<select id="f-region"><option value="">All regions</option>${REGIONS.map((r) => `<option ${listFilters.region === r ? 'selected' : ''}>${r}</option>`).join('')}</select>` : ''}
      <select id="f-sort">
        <option value="" ${!listFilters.sort ? 'selected' : ''}>Created ↓ (newest first)</option>
        <option value="created_asc" ${listFilters.sort === 'created_asc' ? 'selected' : ''}>Created ↑ (oldest first)</option>
        <option value="urgency" ${listFilters.sort === 'urgency' ? 'selected' : ''}>Urgency</option>
      </select>
    </div>
    <div id="ticket-list" class="ticket-list">${skeletonRows()}</div>`;
  $('#f-search').addEventListener('input', debounce((e) => { listFilters.search = e.target.value.trim(); loadTicketList(); }, 350));
  $('#f-status').addEventListener('change', (e) => { listFilters.status = e.target.value; loadTicketList(); });
  $('#f-urg').addEventListener('change', (e) => { listFilters.urgency = e.target.value; loadTicketList(); });
  if (isTech) $('#f-scope').addEventListener('change', (e) => { listFilters.scope = e.target.value; loadTicketList(); });
  if (showDept) $('#f-dept').addEventListener('change', (e) => { listFilters.department = e.target.value; loadTicketList(); });
  if (showRegion) $('#f-region').addEventListener('change', (e) => { listFilters.region = e.target.value; loadTicketList(); });
  $('#f-sort').addEventListener('change', (e) => { listFilters.sort = e.target.value; loadTicketList(); });
  loadTicketList();
}
function ticketsSubtitle() {
  const r = state.user.role;
  if (r === 'Requestor') return 'Issues you have reported';
  if (r.startsWith('Technician')) return 'Tickets in your PIC outlet scope';
  if (r === 'Leader') return 'View-only across your scope';
  return 'Manage and respond to tickets';
}
async function loadTicketList() {
  const qs = new URLSearchParams();
  Object.entries(listFilters).forEach(([k, v]) => { if (v) qs.append(k, v); });
  try {
    const rows = await api.tickets(qs.toString());
    const box = $('#ticket-list'); if (!box) return;
    if (!rows.length) { box.innerHTML = emptyBox('ticket', 'No tickets', CAN_CREATE.includes(state.user.role) ? 'Tap “Report Issue” to create one.' : 'Nothing here in this scope.'); return; }
    box.innerHTML = rows.map(ticketRow).join('');
    $$('.ticket-row', box).forEach((el) => el.addEventListener('click', () => navigate('/tickets/' + el.dataset.id)));
  } catch (e) { const box = $('#ticket-list'); if (box) box.innerHTML = errBox(e); }
}
function ticketRow(t) {
  const sched = t.status === 'On Scheduled' && t.scheduled_at ? `<span class="sched-chip">📅 ${fmtDate(t.scheduled_at)}</span>` : '';
  const pub = t.source === 'public_quick_report' ? '<span class="src-chip">Public</span>' : '';
  return `<div class="ticket-row" data-id="${t.id}">
    <div>${deptTag(t.department)}</div>
    <div style="min-width:0">
      <div class="tnum">${esc(t.ticket_number || '#' + t.id)}${pub}</div>
      <div class="ttitle">${esc(t.title)}</div>
      <div class="tmeta"><span>${esc(t.outlet_code || '—')}${t.region ? ' · ' + esc(t.region) : ''}</span><span>${esc(t.category || '')}</span><span>${esc(t.assignee_name && t.assignee_name !== 'Unassigned' ? '👤 ' + t.assignee_name : 'Unassigned')}</span>${sched}<span class="aging ${agingClass(t)}">${timeAgo(t.created_at)}</span></div>
    </div>
    <div class="tbadges">${urgBadge(t.urgency)}${badge(t.status)}</div>
  </div>`;
}

// ==========================================================================
// View: Queue (admins) — unassigned / new
// ==========================================================================
async function renderQueue() {
  view().innerHTML = `<div class="page-head"><h2>Queue</h2><p>New & unassigned tickets awaiting dispatch</p></div><div id="queue-list" class="ticket-list">${skeletonRows()}</div>`;
  try {
    const all = await api.tickets();
    const rows = all.filter((t) => !t.assigned_technician_id && !['Closed', 'Cancelled', 'Resolved'].includes(t.status));
    const box = $('#queue-list');
    if (!rows.length) { box.innerHTML = emptyBox('inbox', 'Queue is clear', 'No unassigned tickets right now. 🎉'); return; }
    box.innerHTML = rows.map((t) => `<div class="ticket-row" data-id="${t.id}">
      <div>${deptTag(t.department)}</div>
      <div style="min-width:0"><div class="tnum">${esc(t.ticket_number)}</div><div class="ttitle">${esc(t.title)}</div>
        <div class="tmeta"><span>${esc(t.outlet_code)}</span><span>${esc(t.category)}</span><span class="aging ${agingClass(t)}">${timeAgo(t.created_at)}</span></div></div>
      <div class="tbadges">${urgBadge(t.urgency)}<button class="btn-primary" data-assign="${t.id}" style="padding:7px 12px">Assign</button></div></div>`).join('');
    $$('.ticket-row', box).forEach((el) => el.addEventListener('click', (e) => { if (e.target.closest('[data-assign]')) return; navigate('/tickets/' + el.dataset.id); }));
    $$('[data-assign]', box).forEach((b) => b.addEventListener('click', async (e) => { e.stopPropagation(); const t = rows.find((x) => x.id == b.dataset.assign); await openAssignModal(t, () => renderQueue()); }));
  } catch (e) { $('#queue-list').innerHTML = errBox(e); }
}

// ==========================================================================
// View: Ticket detail
// ==========================================================================
let detailUploader = null;
async function renderTicketDetail(id) {
  view().innerHTML = `<div class="loading-inline">Loading ticket…</div>`;
  let data;
  try { data = await api.ticket(id); }
  catch (e) { view().innerHTML = `<div class="page-head"><a href="/tickets" data-nav class="muted">← Back</a></div>${errBox(e)}`; wireNavLinks(); return; }
  const { ticket: t, comments, activity, attachments, assignments } = data;
  const u = state.user;
  const isDeptAdmin = u.role === 'SuperAdmin' || (u.role === 'AdminIT' && t.department === 'IT') || (u.role === 'AdminME' && t.department === 'ME');
  const isAssignedTech = u.role.startsWith('Technician') && t.assigned_technician_id === u.id;
  const canReply = u.role !== 'Leader';

  // Group attachments by the comment they were posted with, so each reply's
  // files render inline on its own timeline entry (openable via preview).
  const attByComment = {};
  for (const a of attachments) {
    if (a.comment_id != null) (attByComment[a.comment_id] = attByComment[a.comment_id] || []).push(a);
  }

  // Merge timeline
  const events = [
    ...comments.map((c) => ({ t: c.created_at, kind: c.is_system ? 'sys' : 'msg', author: c.author_name, role: c.author_role, text: c.message, atts: attByComment[c.id] || [] })),
    ...activity.map((a) => ({ t: a.created_at, kind: 'sys', author: a.actor_name, role: a.actor_role, text: actionText(a) })),
  ].sort((a, b) => new Date(a.t) - new Date(b.t));

  view().innerHTML = `
    <div class="page-head"><a href="/tickets" data-nav class="muted">← Back to list</a></div>
    <div class="detail-top">
      <div style="flex:1;min-width:0">
        <div class="tnum">${esc(t.ticket_number || '#' + t.id)} · ${deptTag(t.department)} ${esc(t.category || '')}</div>
        <h2>${esc(t.title)}</h2>
        <div class="aging ${agingClass(t)}">Reported ${fmtDate(t.created_at)} · ${timeAgo(t.created_at)}</div>
      </div>
      <div class="detail-badges">${urgBadge(t.urgency)}${badge(t.status)}${t.source === 'public_quick_report' ? '<span class="badge src-public" title="Submitted via public Quick Report">Public Quick Report</span>' : ''}</div>
    </div>
    <div class="detail-grid">
      <div>
        <div class="card mb">
          <dl class="info-list">
            <dt>Outlet</dt><dd>${esc(t.outlet_code || '—')} ${t.brand_code ? '· ' + esc(t.brand_code) : ''}</dd>
            ${t.source === 'public_quick_report' ? '<dt>Source</dt><dd><span class="badge src-public">Public Quick Report</span></dd>' : ''}
            <dt>${t.source === 'public_quick_report' ? 'Reporter' : 'Requester'}</dt><dd>${esc(t.public_reporter_name || t.customer_name || '—')}</dd>
            <dt>Contact</dt><dd>${esc(t.public_reporter_contact || t.contact_number || '—')}</dd>
            <dt>Primary Tech</dt><dd>${primaryTechnician ? esc(primaryTechnician.technician_name) : esc(t.assignee_name || 'Unassigned')}</dd>
            ${(collaborators && collaborators.length) ? `<dt>Collaborators</dt><dd>${collaborators.map(c => `<span class="badge" style="margin-right:4px">${esc(c.technician_name)}</span>`).join('')}</dd>` : ''}
            ${t.region ? `<dt>Region</dt><dd>${esc(t.region)}</dd>` : ''}
            ${t.scheduled_at ? `<dt>Scheduled</dt><dd>📅 ${fmtDate(t.scheduled_at)}</dd>` : ''}
            ${t.location_detail ? `<dt>Location</dt><dd>${esc(t.location_detail)}</dd>` : ''}
            ${t.device_equipment ? `<dt>Device</dt><dd>${esc(t.device_equipment)}</dd>` : ''}
            ${t.business_impact ? `<dt>Impact</dt><dd>${esc(t.business_impact)}</dd>` : ''}
            ${t.sparepart_note ? `<dt>Sparepart</dt><dd>${esc(t.sparepart_note)}</dd>` : ''}
            ${t.vendor_note ? `<dt>Vendor</dt><dd>${esc(t.vendor_note)}</dd>` : ''}
            ${t.expected_part_date ? `<dt>Expected</dt><dd>${esc(t.expected_part_date)}</dd>` : ''}
            ${t.resolution_note ? `<dt>Resolution</dt><dd>${esc(t.resolution_note)}</dd>` : ''}
          </dl>
          <div class="divider"></div>
          <div class="tl-msg">${esc(t.description || '')}</div>
        </div>
        ${attachments.length ? `<div class="panel mb"><div class="panel-head"><h3>Evidence & photos</h3></div><div class="card" style="border:none"><div class="tl-atts">${attachments.map(attCard).join('')}</div></div></div>` : ''}
        <div class="panel"><div class="panel-head"><h3>Activity</h3></div><div class="card" style="border:none">
          <div class="timeline">${events.length ? events.map(tlItem).join('') : '<p class="muted">No activity yet.</p>'}</div>
          ${canReply ? replyBoxHTML() : '<p class="muted mt">View-only role.</p>'}
        </div></div>
      </div>
      <div id="action-pane">${actionPaneHTML(t, isDeptAdmin, isAssignedTech)}</div>
    </div>`;
  wireNavLinks();
  if (canReply) wireReply(t);
  wireActionPane(t, isDeptAdmin, isAssignedTech);
}
function actionText(a) { return a.detail ? `${humanAction(a.action)} — ${a.detail}` : humanAction(a.action); }
function humanAction(a) { return ({ 'ticket.created': 'Ticket created', 'ticket.assigned': 'Assigned', 'status.changed': 'Status changed', 'urgency.changed': 'Urgency changed', 'comment.added': 'Comment', 'department.changed': 'Re-routed', 'category.changed': 'Category changed', 'outlet.changed': 'Outlet changed' }[a] || a); }
function tlItem(e) {
  const atts = (e.atts && e.atts.length) ? `<div class="tl-atts">${e.atts.map(attCard).join('')}</div>` : '';
  if (e.kind === 'sys') return `<div class="tl-item sys"><div class="tl-head"><span class="tl-author">${esc(e.author || 'System')}</span><span class="tl-time">${fmtDate(e.t)}</span></div><div class="tl-msg">${esc(e.text)}</div>${atts}</div>`;
  return `<div class="tl-item"><div class="tl-head"><span class="tl-author">${esc(e.author)}</span><span class="tl-role">${esc(e.role)}</span><span class="tl-time">${fmtDate(e.t)}</span></div><div class="tl-msg">${esc(e.text)}</div>${atts}</div>`;
}
function attCard(a) {
  const isImg = (a.mime_type || '').startsWith('image/');
  const phaseTag = a.phase && a.phase !== 'general' ? `<span class="phase-tag phase-${esc(a.phase)}">${esc(a.phase)}</span>` : '';
  if (isImg) return `<a class="att-card att-img" href="${esc(a.file_url)}" target="_blank" data-preview="${esc(a.file_url)}" data-preview-name="${esc(a.file_name)}" style="flex-direction:column;align-items:stretch;width:150px">${phaseTag}<img class="att-thumb" src="${esc(a.file_url)}" alt="${esc(a.file_name)}" loading="lazy"><span class="an">${esc(a.file_name)}</span></a>`;
  return `<a class="att-card" href="${esc(a.file_url)}" target="_blank">${svg('<polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/>', 16)}${phaseTag}<span class="an">${esc(a.file_name)}</span></a>`;
}
function replyBoxHTML() {
  return `<div class="reply-box">
    <textarea id="reply-msg" placeholder="Write an update or reply…"></textarea>
    ${uploadZoneHTML('reply-up')}
    <div class="reply-tools">
      <select id="reply-phase"><option value="general">General</option><option value="before">Before repair</option><option value="after">After repair</option></select>
      <button class="btn-primary right" id="reply-send">Send</button>
    </div></div>`;
}
function wireReply(t) {
  detailUploader = new Uploader($('#reply-up'), $('#reply-up-list'));
  const btn = $('#reply-send');
  btn.addEventListener('click', async () => {
    const msg = $('#reply-msg').value.trim();
    const ids = detailUploader.ids();
    if (!msg && !ids.length) { toast('Write a message or add a photo', 'error'); return; }
    if (detailUploader.uploading()) { toast('Wait for uploads to finish', 'error'); return; }
    btn.disabled = true; btn.textContent = 'Sending…';
    try {
      await api.comment(t.id, { message: msg, attachmentIds: ids, phase: $('#reply-phase').value });
      toast('Reply posted', 'success');
      renderTicketDetail(t.id);
    } catch (e) { toast(e.message, 'error'); btn.disabled = false; btn.textContent = 'Send'; }
  });
}
// A technician may self-assign a ticket in their own department that isn't
// closed/cancelled and isn't already theirs. Backend re-checks PIC/outlet scope.
function canSelfAssign(t) {
  const u = state.user;
  if (!u.role.startsWith('Technician')) return false;
  const myDept = u.role === 'TechnicianIT' ? 'IT' : 'ME';
  if (t.department !== myDept) return false;
  if (t.assigned_technician_id === u.id) return false;
  if (['Closed', 'Cancelled'].includes(t.status)) return false;
  return true;
}
function actionPaneHTML(t, isDeptAdmin, isAssignedTech) {
  if (!isDeptAdmin && !isAssignedTech) {
    const selfAssign = canSelfAssign(t)
      ? `<button class="btn-primary btn-block mt" id="act-selfassign">＋ Assign to me</button>`
      : '';
    return `<div class="card"><h3 style="font-size:.95rem;margin-bottom:6px">Status</h3>${badge(t.status)}<p class="muted mt" style="font-size:.8rem">You’ll be notified of updates here.</p>${selfAssign}</div>`;
  }
  let html = `<div class="card"><h3 style="font-size:.95rem;margin-bottom:12px">Actions</h3>`;
  // Assignment (admin)
  if (isDeptAdmin) {
    html += `<div class="field"><label>Assignment</label><div class="row"><div style="flex:1">${esc(t.assignee_name || 'Unassigned')}</div><button class="btn-outline" id="btn-assign" style="padding:7px 12px">${t.assigned_technician_id ? 'Reassign' : 'Assign'}</button></div></div>`;
  }
  // Status controls
  const opts = isDeptAdmin ? STATUSES : TECH_STATUSES;
  html += `<div class="field"><label>Update status</label><select id="act-status">${opts.map((s) => `<option ${s === t.status ? 'selected' : ''}>${s}</option>`).join('')}</select></div>`;
  if (isDeptAdmin) {
    html += `<div class="field"><label>Urgency</label><select id="act-urg">${URGENCIES.map((s) => `<option ${s === t.urgency ? 'selected' : ''}>${s}</option>`).join('')}</select></div>`;
  }
  html += `<button class="btn-primary btn-block" id="act-apply">Apply</button>`;
  if (isDeptAdmin) html += `<button class="btn-ghost btn-block mt" id="act-advanced">Re-route dept / category</button>`;
  html += `</div>`;
  return html;
}
function wireActionPane(t, isDeptAdmin, isAssignedTech) {
  const selfBtn = $('#act-selfassign');
  if (selfBtn) selfBtn.addEventListener('click', async () => {
    selfBtn.disabled = true; selfBtn.textContent = 'Assigning…';
    try { await api.assignToMe(t.id); toast('Ticket assigned to you', 'success'); renderTicketDetail(t.id); }
    catch (e) { toast(e.message, 'error'); selfBtn.disabled = false; selfBtn.textContent = '＋ Assign to me'; }
  });
  if (!isDeptAdmin && !isAssignedTech) return;
  const assignBtn = $('#btn-assign'); if (assignBtn) assignBtn.addEventListener('click', () => openAssignModal(t, () => renderTicketDetail(t.id)));
  const apply = $('#act-apply');
  apply.addEventListener('click', async () => {
    const newStatus = $('#act-status').value;
    const patch = {};
    if (isDeptAdmin && $('#act-urg') && $('#act-urg').value !== t.urgency) patch.urgency = $('#act-urg').value;
    // Collect required extras for certain transitions
    const extra = await collectStatusExtras(t, newStatus);
    if (extra === null && newStatus !== t.status) return; // cancelled dialog
    Object.assign(patch, extra || {});
    if (newStatus !== t.status) patch.status = newStatus;
    if (!Object.keys(patch).length) { toast('No changes', 'info'); return; }
    apply.disabled = true; apply.textContent = 'Applying…';
    try { await api.patchTicket(t.id, patch); toast('Ticket updated', 'success'); renderTicketDetail(t.id); }
    catch (e) { toast(e.message, 'error'); apply.disabled = false; apply.textContent = 'Apply'; }
  });
  const adv = $('#act-advanced'); if (adv) adv.addEventListener('click', () => openRerouteModal(t));
}
async function collectStatusExtras(t, newStatus) {
  if (newStatus === t.status) return {};
  if (newStatus === 'Resolved' || newStatus === 'Closed') {
    if (t.resolution_note && newStatus === 'Closed') return {};
    const v = await formModal(newStatus === 'Resolved' ? 'Mark Resolved' : 'Close ticket',
      [{ name: 'resolution_note', label: 'Resolution note (what was done)', type: 'textarea', required: true, value: t.resolution_note || '' }], newStatus);
    return v;
  }
  if (newStatus === 'Cancelled') {
    return await formModal('Cancel ticket', [{ name: 'cancel_reason', label: 'Reason for cancellation', type: 'textarea', required: true }], 'Cancel ticket');
  }
  if (newStatus === 'On Scheduled') {
    return await formModal('Schedule work', [
      { name: 'scheduled_at', label: 'Planned date & time', type: 'datetime-local', required: true, value: t.scheduled_at ? String(t.scheduled_at).replace(' ', 'T').slice(0, 16) : '' },
    ], 'Set schedule');
  }
  if (newStatus === 'Waiting Sparepart') {
    return await formModal('Waiting for sparepart', [
      { name: 'sparepart_note', label: 'Sparepart needed', type: 'text' },
      { name: 'expected_part_date', label: 'Expected date (optional)', type: 'date' },
    ], 'Set status');
  }
  if (newStatus === 'Waiting Vendor') {
    return await formModal('Waiting for vendor', [
      { name: 'vendor_note', label: 'Vendor / detail', type: 'text' },
      { name: 'expected_part_date', label: 'Expected date (optional)', type: 'date' },
    ], 'Set status');
  }
  if (t.status === 'Closed') {
    return await formModal('Reopen ticket', [{ name: 'reason', label: 'Reason for reopening', type: 'textarea', required: true }], 'Reopen');
  }
  return {};
}
async function openRerouteModal(t) {
  const other = t.department === 'IT' ? 'ME' : 'IT';
  let cats = [];
  const v = await formModal('Re-route / edit', [
    { name: 'department', label: 'Department', type: 'select', value: t.department, options: [{ value: 'IT', label: 'IT' }, { value: 'ME', label: 'ME (Mechanical)' }] },
    { name: 'category', label: 'Category (must match dept)', type: 'text', value: t.category, hint: `Switching to ${other} is an escalation; the ticket number stays the same.` },
  ], 'Save');
  if (!v) return;
  const patch = {};
  if (v.department !== t.department) patch.department = v.department;
  if (v.category && v.category !== t.category) patch.category = v.category;
  if (!Object.keys(patch).length) return;
  try { await api.patchTicket(t.id, patch); toast('Ticket re-routed', 'success'); renderTicketDetail(t.id); }
  catch (e) { toast(e.message, 'error'); }
}

// Assignment modal with multi-technician support (Primary + Collaborators)
async function openAssignModal(t, after) {
  const { overlay, close } = openModal({
    title: 'Manage Assignment — ' + (t.ticket_number || '#' + t.id),
    bodyHTML: `<div id="cur-assign-box" class="mb"><div class="loading-inline">Loading current assignment status…</div></div>
      <div id="rec-box"><div class="loading-inline">Finding available technicians…</div></div>
      <div class="divider"></div>
      <div class="field"><label>Select Technician</label><select id="manual-tech"><option value="">Choose technician…</option></select></div>
      <div class="field"><label>Assignment Role</label>
        <select id="assign-role-type">
          <option value="primary">Primary Technician (PIC)</option>
          <option value="collaborator">Collaborator / Additional Agent</option>
        </select>
      </div>
      <label class="row gap-sm" style="cursor:pointer;font-size:.82rem"><input type="checkbox" id="ov-check" style="width:auto"> Force even if wrong department / off-duty</label>`,
    footHTML: `<button class="btn-ghost" data-cancel>Cancel</button><button class="btn-primary" data-manual>Assign Selected</button>`,
    size: 'lg',
    async onMount(ov, close) {
      $('[data-cancel]', ov).addEventListener('click', close);
      try {
        const [ticketData, recs, techs] = await Promise.all([
          api.ticket(t.id),
          api.recommend(t.id).catch(() => []),
          api.technicians(t.department).catch(() => []),
        ]);

        const curBox = $('#cur-assign-box', ov);
        const activeAss = ticketData.activeAssignments || [];
        if (activeAss.length) {
          curBox.innerHTML = `
            <div style="font-weight:600;margin-bottom:6px;font-size:.88rem">Active Technicians:</div>
            <div style="display:flex;flex-wrap:wrap;gap:8px">
              ${activeAss.map(a => `
                <div style="background:var(--bg-muted, #1e293b);border:1px solid var(--border, #334155);padding:6px 10px;border-radius:6px;font-size:.82rem;display:flex;align-items:center;gap:6px">
                  <span>${esc(a.technician_name)}</span>
                  <span class="badge ${a.role_type === 'primary' ? 'badge-primary' : ''}">${a.role_type === 'primary' ? 'Primary' : 'Collaborator'}</span>
                  <button type="button" class="btn-ghost" data-remove-tech="${a.technician_id}" style="padding:2px 6px;color:var(--danger, #ef4444);font-size:11px" title="Remove technician">✕</button>
                </div>
              `).join('')}
            </div>`;
          $$('[data-remove-tech]', ov).forEach(b => {
            b.addEventListener('click', async () => {
              try {
                await api.assign(t.id, { technician_id: Number(b.dataset.removeTech), action: 'remove' });
                toast('Technician assignment removed', 'info');
                close();
                if (after) after();
              } catch (err) {
                toast(err.message, 'error');
              }
            });
          });
        } else {
          curBox.innerHTML = `<div class="muted" style="font-size:.84rem">No active technician assigned to this ticket.</div>`;
        }

        const rb = $('#rec-box', ov);
        rb.innerHTML = recs.length ? recs.map((r, i) => `
          <div class="rec-item ${i === 0 && r.available ? 'best' : ''}">
            <div class="rec-info"><div class="rec-name">${esc(r.username)} ${i === 0 && r.available ? '⭐' : ''}</div><div class="rec-reasons">${esc(r.reasons.join(' · '))}</div></div>
            <span class="rec-avail ${r.available ? 'yes' : 'no'}">${r.available ? 'available' : 'busy'}</span>
            <button class="btn-primary" data-rec="${r.id}" style="padding:7px 12px">Assign Primary</button>
          </div>`).join('') : '<p class="muted">No technicians configured for this department.</p>';

        $('#manual-tech', ov).innerHTML = '<option value="">Choose technician…</option>' + techs.map((x) => `<option value="${x.id}">${esc(x.username)} (${x.workload} open)</option>`).join('');
        $$('[data-rec]', ov).forEach((b) => b.addEventListener('click', () => doAssign(t, b.dataset.rec, 'primary', false, close, after)));
      } catch (e) { $('#rec-box', ov).innerHTML = errBox(e); }

      $('[data-manual]', ov).addEventListener('click', () => {
        const id = $('#manual-tech', ov).value; if (!id) { toast('Pick a technician', 'error'); return; }
        const roleType = $('#assign-role-type', ov).value;
        doAssign(t, id, roleType, $('#ov-check', ov).checked, close, after);
      });
    },
  });
}
async function doAssign(t, techId, roleType, override, close, after) {
  try {
    await api.assign(t.id, { technician_id: Number(techId), role_type: roleType || 'primary', override });
    toast('Technician assignment updated', 'success'); close(); if (after) after();
  } catch (e) {
    if (/override/i.test(e.message)) toast(e.message + ' Tick the override box to force.', 'error');
    else toast(e.message, 'error');
  }
}

// ==========================================================================
// View: Schedules — big weekly calendar planner (+ cards view)
// ==========================================================================
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DOW_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MON_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const CAL_HOUR_H = 46; // px per hour row

const techDept = (t) => t.department || (t.role === 'TechnicianIT' ? 'IT' : t.role === 'TechnicianME' ? 'ME' : 'IT');
function techInitials(name) {
  return String(name || '?').trim().split(/\s+/).map((w) => w[0] || '').slice(0, 2).join('').toUpperCase() || '?';
}
const hhmmToMin = (s) => { const p = String(s || '0:0').split(':'); return (Number(p[0]) || 0) * 60 + (Number(p[1]) || 0); };
const pad2 = (n) => String(n).padStart(2, '0');
const minLabel = (m) => pad2(Math.floor(m / 60)) + ':' + pad2(m % 60);

const schedState = { view: 'calendar', weekOffset: 0, dept: '', search: '', startHour: 0, sidebarOpen: true, hidden: {}, data: null, lockedDept: '' };
let _schedPop = null;

function schedWeekDates(offset) {
  const now = new Date();
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  base.setDate(base.getDate() - base.getDay() + offset * 7); // Sunday of target week
  return Array.from({ length: 7 }, (_, i) => { const d = new Date(base); d.setDate(base.getDate() + i); return d; });
}
const fmtDay = (d) => MON_ABBR[d.getMonth()] + ' ' + d.getDate();
const findTech = (id) => (schedState.data || []).find((r) => String(r.tech.id) === String(id));

async function renderSchedules() {
  const lockedDept = state.user.role === 'AdminIT' ? 'IT' : state.user.role === 'AdminME' ? 'ME' : '';
  schedState.lockedDept = lockedDept;
  schedState.dept = lockedDept || schedState.dept || '';
  view().innerHTML = `
    <div class="page-head"><h2>Technician schedules</h2><p>Weekly availability for IT &amp; Mechanical — plan coverage and assignments at a glance.</p></div>
    <div class="sched-toolbar2">
      <div class="sched-weeknav">
        <button class="btn-outline btn-icon" id="wk-prev" title="Previous week" aria-label="Previous week">‹</button>
        <button class="btn-outline btn-sm" id="wk-today">Today</button>
        <button class="btn-outline btn-icon" id="wk-next" title="Next week" aria-label="Next week">›</button>
        <span class="sched-weeklabel" id="wk-label">—</span>
      </div>
      <div class="sched-toolbar2-right">
        ${!lockedDept ? `<select id="sch-dept" aria-label="Department"><option value="">All departments</option><option value="IT">IT</option><option value="ME">Mechanical</option></select>` : ''}
        <div class="search"><input id="sch-search" placeholder="Search technician…" aria-label="Search technician"></div>
        <button class="btn-outline btn-sm" id="sch-hours-toggle" title="Show 06:00–24:00 only">Business hrs</button>
        <div class="seg" id="sch-viewseg"><button class="seg-b" data-view="calendar">Calendar</button><button class="seg-b" data-view="cards">Cards</button></div>
      </div>
    </div>
    <div id="sched-content"><div class="loading-inline">Loading schedules…</div></div>`;

  if (!lockedDept) { $('#sch-dept').value = schedState.dept; $('#sch-dept').addEventListener('change', (e) => { schedState.dept = e.target.value; fetchSched(); }); }
  $('#sch-search').value = schedState.search;
  $$('#sch-viewseg .seg-b').forEach((b) => { b.classList.toggle('active', b.dataset.view === schedState.view); b.addEventListener('click', () => { schedState.view = b.dataset.view; $$('#sch-viewseg .seg-b').forEach((x) => x.classList.toggle('active', x === b)); renderSchedContent(); }); });
  $('#sch-hours-toggle').classList.toggle('active', schedState.startHour === 6);
  $('#wk-prev').addEventListener('click', () => { schedState.weekOffset--; renderSchedContent(); });
  $('#wk-next').addEventListener('click', () => { schedState.weekOffset++; renderSchedContent(); });
  $('#wk-today').addEventListener('click', () => { schedState.weekOffset = 0; renderSchedContent(); });
  $('#sch-hours-toggle').addEventListener('click', () => { schedState.startHour = schedState.startHour === 0 ? 6 : 0; $('#sch-hours-toggle').classList.toggle('active', schedState.startHour === 6); renderSchedContent(); });
  $('#sch-search').addEventListener('input', debounce((e) => { schedState.search = e.target.value.trim().toLowerCase(); renderSchedContent(); }, 140));

  await fetchSched();
}

async function fetchSched() {
  const box = $('#sched-content'); if (box) box.innerHTML = `<div class="loading-inline">Loading schedules…</div>`;
  try {
    const techs = await api.technicians(schedState.dept || undefined);
    schedState.data = await Promise.all(techs.map(async (t) => {
      try { const s = await api.schedules(t.id); return { tech: t, schedules: s.schedules || [], unavailability: s.unavailability || [] }; }
      catch (_) { return { tech: t, schedules: [], unavailability: [] }; }
    }));
    renderSchedContent();
  } catch (e) { const b = $('#sched-content'); if (b) b.innerHTML = errBox(e); }
}

function schedVisibleData() {
  const q = schedState.search;
  return (schedState.data || []).filter((r) => !schedState.hidden[r.tech.id] && (!q || String(r.tech.username).toLowerCase().includes(q)));
}

function renderSchedContent() {
  closeSchedPopover();
  const box = $('#sched-content'); if (!box) return;
  const dates = schedWeekDates(schedState.weekOffset);
  const lbl = $('#wk-label'); if (lbl) lbl.textContent = fmtDay(dates[0]) + ' – ' + fmtDay(dates[6]) + ', ' + dates[6].getFullYear();
  if (!schedState.data) { box.innerHTML = `<div class="loading-inline">Loading…</div>`; return; }
  if (!schedState.data.length) { box.innerHTML = emptyBox('users', 'No technicians', 'Add technician users first.'); return; }
  box.innerHTML = schedState.view === 'cards' ? renderSchedCardsView() : renderSchedCalendarView(dates);
  wireSchedContent();
}

// ---- calendar view --------------------------------------------------------
function schedEventsForWeek(dates) {
  const days = [[], [], [], [], [], [], []];
  const rows = schedVisibleData();
  rows.forEach((row) => {
    const dept = techDept(row.tech);
    row.schedules.forEach((s) => {
      const di = s.day_of_week;
      if (di >= 0 && di <= 6) days[di].push({ kind: 'work', tech: row.tech, dept, startMin: hhmmToMin(s.start_time), endMin: hhmmToMin(s.end_time), id: s.id });
    });
    row.unavailability.forEach((u) => {
      const start = new Date(u.start_datetime), end = new Date(u.end_datetime);
      if (isNaN(start.getTime()) || isNaN(end.getTime())) return;
      dates.forEach((d, di) => {
        const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0);
        const dayEnd = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59);
        if (end < dayStart || start > dayEnd) return;
        const s0 = start < dayStart ? 0 : start.getHours() * 60 + start.getMinutes();
        const e0 = end > dayEnd ? 1440 : end.getHours() * 60 + end.getMinutes();
        if (e0 > s0) days[di].push({ kind: 'off', tech: row.tech, dept, startMin: s0, endMin: e0, id: u.id });
      });
    });
  });
  return days;
}

function packDay(events) {
  events.sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
  let i = 0;
  while (i < events.length) {
    let clusterEnd = events[i].endMin, j = i + 1;
    const cluster = [events[i]];
    while (j < events.length && events[j].startMin < clusterEnd) { cluster.push(events[j]); clusterEnd = Math.max(clusterEnd, events[j].endMin); j++; }
    const colEnds = [];
    cluster.forEach((ev) => { let c = 0; while (c < colEnds.length && colEnds[c] > ev.startMin) c++; ev._col = c; colEnds[c] = ev.endMin; });
    cluster.forEach((ev) => (ev._cols = colEnds.length));
    i = j;
  }
}

function schedBlockHTML(ev, startHour) {
  const minTop = startHour * 60;
  const effStart = Math.max(ev.startMin, minTop);
  const top = ((effStart - minTop) / 60) * CAL_HOUR_H;
  const height = Math.max(((ev.endMin - effStart) / 60) * CAL_HOUR_H, 22);
  const w = 100 / (ev._cols || 1), left = (ev._col || 0) * w;
  const range = minLabel(ev.startMin) + '–' + minLabel(ev.endMin);
  const cls = ev.kind === 'off' ? 'cal-ev is-off' : 'cal-ev dept-' + ev.dept;
  const title = (ev.kind === 'off' ? 'Day off' : ev.dept + ' hours') + ' · ' + ev.tech.username + ' · ' + range;
  const body = ev.kind === 'off'
    ? `<span class="cal-ev-t">${esc(ev.tech.username)}</span><span class="cal-ev-s">Day off</span>`
    : `<span class="cal-ev-t">${esc(ev.tech.username)}</span><span class="cal-ev-s">${range}</span>${height > 52 ? `<span class="cal-ev-s2">${ev.tech.workload} open</span>` : ''}`;
  return `<button class="${cls}" style="top:${top}px;height:${height}px;left:calc(${left}% + 2px);width:calc(${w}% - 4px)" title="${esc(title)}" data-ev="${ev.kind}" data-id="${ev.id}" data-tech="${ev.tech.id}">${body}</button>`;
}

function renderSchedCalendarView(dates) {
  const startHour = schedState.startHour;
  const totalH = (24 - startHour) * CAL_HOUR_H;
  const todayIdx = schedState.weekOffset === 0 ? new Date().getDay() : -1;
  const dayEvents = schedEventsForWeek(dates);
  dayEvents.forEach(packDay);

  const headCells = dates.map((d, i) => `<div class="cal-dhead${i === todayIdx ? ' is-today' : ''}"><span class="cal-dow">${DOW[i]}</span><span class="cal-dnum">${d.getDate()}</span></div>`).join('');
  const hours = []; for (let h = startHour; h <= 24; h++) hours.push(h);
  const gutter = hours.map((h) => `<div class="cal-hr"><span>${h === 24 ? '24:00' : pad2(h) + ':00'}</span></div>`).join('');
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
  const cols = dates.map((d, i) => {
    const blocks = dayEvents[i].map((ev) => schedBlockHTML(ev, startHour)).join('') || '';
    let now = '';
    if (i === todayIdx && nowMin >= startHour * 60) now = `<div class="cal-now" style="top:${((nowMin - startHour * 60) / 60) * CAL_HOUR_H}px"><span class="cal-now-dot"></span></div>`;
    return `<div class="cal-col${i === todayIdx ? ' is-today' : ''}" style="height:${totalH}px">${blocks}${now}</div>`;
  }).join('');

  return `<div class="sched-layout${schedState.sidebarOpen ? '' : ' sidebar-collapsed'}">
    ${renderSchedSidebar(dates)}
    <div class="cal-wrap">
      <div class="cal">
        <div class="cal-head">
          <div class="cal-corner"><button class="cal-sb-toggle" id="cal-sb-toggle" title="Toggle side panel" aria-label="Toggle side panel">☰</button></div>
          ${headCells}
        </div>
        <div class="cal-body">
          <div class="cal-gutter" style="height:${totalH}px">${gutter}</div>
          ${cols}
        </div>
      </div>
    </div>
  </div>`;
}

function renderSchedSidebar(dates) {
  const all = schedState.data || [];
  const it = all.filter((r) => techDept(r.tech) === 'IT').length;
  const me = all.filter((r) => techDept(r.tech) === 'ME').length;
  const now = new Date(), nowDay = now.getDay(), nowMin = now.getHours() * 60 + now.getMinutes();
  const isCurrent = schedState.weekOffset === 0;
  let availNow = 0, offNow = 0;
  all.forEach((r) => {
    const working = r.schedules.some((s) => s.day_of_week === nowDay && hhmmToMin(s.start_time) <= nowMin && hhmmToMin(s.end_time) > nowMin);
    const blocked = r.unavailability.some((u) => { const s = new Date(u.start_datetime), e = new Date(u.end_datetime); return s <= now && now <= e; });
    if (working && !blocked) availNow++;
    if (blocked) offNow++;
  });
  const stat = (n, l, cls) => `<div class="sched-stat ${cls || ''}"><span class="n">${n}</span><span class="l">${l}</span></div>`;
  const rows = all.map((r) => {
    const dept = techDept(r.tech);
    return `<div class="sched-techrow" data-tech="${r.tech.id}">
      <label class="sched-techrow-main"><input type="checkbox" ${schedState.hidden[r.tech.id] ? '' : 'checked'} data-toggle="${r.tech.id}"><span class="sched-dot dept-${dept}"></span><span class="sched-techrow-name">${esc(r.tech.username)}</span>${deptTag(dept)}</label>
      <span class="sched-techrow-open" title="Open tickets">${r.tech.workload}</span>
      <button class="mini-btn" data-add-hrs="${r.tech.id}" title="Add working hours">＋</button>
      <button class="mini-btn" data-add-off="${r.tech.id}" title="Add day off / block">⦸</button>
    </div>`;
  }).join('');
  return `<aside class="sched-side">
    <div class="sched-side-stats">
      ${stat(all.length, 'Technicians')}${stat(it, 'IT', 'is-it')}${stat(me, 'ME', 'is-me')}
      ${stat(isCurrent ? availNow : '—', 'Available now', 'is-ok')}${stat(isCurrent ? offNow : '—', 'Off / blocked', 'is-off')}
    </div>
    <div class="sched-side-sec"><div class="sched-side-h">Technicians</div><div class="sched-techlist">${rows || '<p class="muted" style="font-size:.8rem;padding:4px 2px">No technicians</p>'}</div></div>
    <div class="sched-side-sec"><div class="sched-side-h">Legend</div><div class="sched-legend2">
      <span><i class="sw sw-it"></i>IT working hours</span><span><i class="sw sw-me"></i>ME working hours</span>
      <span><i class="sw sw-off"></i>Day off / blocked</span><span><i class="sw sw-now"></i>Current time</span>
    </div></div>
  </aside>`;
}

// ---- cards view (compact per-technician week) -----------------------------
function renderSchedCardsView() {
  const rows = schedVisibleData();
  if (!rows.length) return emptyBox('users', 'No technicians', 'No technician matches your filters.');
  const today = schedState.weekOffset === 0 ? new Date().getDay() : -1;
  return rows.map((row) => {
    const t = row.tech, dept = techDept(t);
    const byDay = [[], [], [], [], [], [], []];
    row.schedules.forEach((s) => { if (byDay[s.day_of_week]) byDay[s.day_of_week].push(s); });
    byDay.forEach((a) => a.sort((x, y) => String(x.start_time).localeCompare(String(y.start_time))));
    const week = DOW.map((dn, i) => `<div class="sched-daycol${i === today ? ' is-today' : ''}"><div class="sched-dayname">${dn}</div><div class="sched-daybody">${byDay[i].length ? byDay[i].map((s) => `<div class="sched-block"><span class="sched-time">${esc(s.start_time)}–${esc(s.end_time)}</span><button class="sched-del" data-del="${s.id}" data-tech="${t.id}" title="Remove">✕</button></div>`).join('') : '<div class="sched-off-cell">Off</div>'}</div></div>`).join('');
    const timeoff = row.unavailability.length ? `<div class="sched-timeoff"><div class="sched-timeoff-label">Day off / blocked time</div><div class="sched-timeoff-list">${row.unavailability.map((u) => `<div class="sched-offblock"><span class="sched-offblock-range">${esc(fmtDate(u.start_datetime))} → ${esc(fmtDate(u.end_datetime))}</span>${u.reason ? `<span class="sched-offblock-reason">${esc(u.reason)}</span>` : ''}<button class="sched-del" data-udel="${u.id}" data-tech="${t.id}" title="Remove">✕</button></div>`).join('')}</div></div>` : '';
    const hint = row.schedules.length ? '' : `<div class="sched-emptyhint">No working hours set yet.</div>`;
    return `<div class="panel sched-tech sched-dept-${dept}">
      <div class="sched-tech-head"><div class="sched-tech-id"><span class="sched-avatar">${esc(techInitials(t.username))}</span><div class="sched-tech-meta"><div class="sched-tech-name">${esc(t.username)} ${deptTag(dept)}</div><div class="sched-tech-sub">${dept} Technician · <strong>${t.workload}</strong> open</div></div></div>
      <div class="sched-tech-actions"><button class="btn-outline btn-sm" data-add-hrs="${t.id}">+ Working hours</button><button class="btn-outline btn-sm" data-add-off="${t.id}">+ Day off</button></div></div>
      <div class="sched-body">${week}${hint}${timeoff}</div>
    </div>`;
  }).join('');
}

// ---- shared wiring & actions ---------------------------------------------
function wireSchedContent() {
  const box = $('#sched-content'); if (!box) return;
  const sb = $('#cal-sb-toggle', box);
  if (sb) sb.addEventListener('click', () => { schedState.sidebarOpen = !schedState.sidebarOpen; renderSchedContent(); });
  $$('[data-toggle]', box).forEach((cb) => cb.addEventListener('change', () => { schedState.hidden[cb.dataset.toggle] = !cb.checked; renderSchedContent(); }));
  $$('[data-add-hrs]', box).forEach((b) => b.addEventListener('click', (e) => { e.preventDefault(); const r = findTech(b.dataset.addHrs); if (r) schedAddHours(r.tech); }));
  $$('[data-add-off]', box).forEach((b) => b.addEventListener('click', (e) => { e.preventDefault(); const r = findTech(b.dataset.addOff); if (r) schedAddOff(r.tech); }));
  $$('.cal-ev', box).forEach((el) => el.addEventListener('click', (e) => { e.stopPropagation(); openEventPopover(el); }));
  $$('.sched-del[data-del]', box).forEach((b) => b.addEventListener('click', async (e) => {
    e.preventDefault(); const r = findTech(b.dataset.tech); if (!r) return;
    if (!(await confirmModal('Remove working hours', 'Remove this working-hours block?', 'Remove'))) return;
    try { await api.delSchedule(r.tech.id, b.dataset.del); toast('Working hours removed', 'success'); fetchSched(); } catch (err) { toast(err.message, 'error'); }
  }));
  $$('.sched-del[data-udel]', box).forEach((b) => b.addEventListener('click', async (e) => {
    e.preventDefault(); const r = findTech(b.dataset.tech); if (!r) return;
    if (!(await confirmModal('Remove block', 'Remove this day off / blocked time?', 'Remove'))) return;
    try { await api.delUnavail(r.tech.id, b.dataset.udel); toast('Block removed', 'success'); fetchSched(); } catch (err) { toast(err.message, 'error'); }
  }));
}

async function schedAddHours(t) {
  const v = await formModal('Add working hours — ' + t.username, [
    { name: 'day_of_week', label: 'Day', type: 'select', value: '1', options: DOW.map((d, i) => ({ value: String(i), label: DOW_FULL[i] })) },
    { name: 'start_time', label: 'Start time', type: 'time', value: '09:00', required: true },
    { name: 'end_time', label: 'End time', type: 'time', value: '18:00', required: true },
  ], 'Add hours');
  if (!v) return;
  if (v.end_time <= v.start_time) return toast('End time must be after start time', 'error');
  try { await api.addSchedule(t.id, { day_of_week: Number(v.day_of_week), start_time: v.start_time, end_time: v.end_time }); toast('Working hours added', 'success'); fetchSched(); }
  catch (e) { toast(e.message, 'error'); }
}
async function schedAddOff(t) {
  const v = await formModal('Add day off / block — ' + t.username, [
    { name: 'start_datetime', label: 'From', type: 'datetime-local', required: true },
    { name: 'end_datetime', label: 'To', type: 'datetime-local', required: true },
    { name: 'reason', label: 'Reason (optional)', type: 'text', placeholder: 'e.g. Annual leave' },
  ], 'Save block');
  if (!v) return;
  if (v.end_datetime <= v.start_datetime) return toast('End must be after start', 'error');
  try { await api.addUnavail(t.id, v); toast('Day off / block saved', 'success'); fetchSched(); }
  catch (e) { toast(e.message, 'error'); }
}

// ---- event popover --------------------------------------------------------
function openSchedPopover(anchorEl, html) {
  closeSchedPopover();
  const pop = document.createElement('div');
  pop.className = 'sched-pop';
  pop.innerHTML = html;
  document.body.appendChild(pop);
  const r = anchorEl.getBoundingClientRect();
  const pr = pop.getBoundingClientRect();
  let left = r.right + 8; if (left + pr.width > window.innerWidth - 8) left = r.left - pr.width - 8;
  if (left < 8) left = Math.max(8, Math.min(r.left, window.innerWidth - pr.width - 8));
  let top = r.top; if (top + pr.height > window.innerHeight - 8) top = window.innerHeight - pr.height - 8;
  if (top < 8) top = 8;
  pop.style.left = left + 'px'; pop.style.top = top + 'px';
  const onDoc = (e) => { if (!pop.contains(e.target)) closeSchedPopover(); };
  const onKey = (e) => { if (e.key === 'Escape') closeSchedPopover(); };
  setTimeout(() => { document.addEventListener('mousedown', onDoc); document.addEventListener('keydown', onKey); }, 0);
  _schedPop = { el: pop, onDoc, onKey };
  return pop;
}
function closeSchedPopover() {
  if (!_schedPop) return;
  document.removeEventListener('mousedown', _schedPop.onDoc);
  document.removeEventListener('keydown', _schedPop.onKey);
  _schedPop.el.remove();
  _schedPop = null;
}
function openEventPopover(el) {
  const kind = el.dataset.ev, id = el.dataset.id, r = findTech(el.dataset.tech);
  if (!r) return;
  const dept = techDept(r.tech);
  let html, onDelete;
  if (kind === 'off') {
    const u = r.unavailability.find((x) => String(x.id) === String(id)); if (!u) return;
    html = `<div class="pop-head"><span class="sched-dot sw-off"></span><strong>${esc(r.tech.username)}</strong> ${deptTag(dept)}</div>
      <div class="pop-row"><span>Type</span><b>Day off / blocked</b></div>
      <div class="pop-row"><span>From</span><b>${esc(fmtDate(u.start_datetime))}</b></div>
      <div class="pop-row"><span>To</span><b>${esc(fmtDate(u.end_datetime))}</b></div>
      ${u.reason ? `<div class="pop-row"><span>Reason</span><b>${esc(u.reason)}</b></div>` : ''}
      <div class="pop-foot"><button class="btn-danger btn-sm" data-del>Delete block</button></div>`;
    onDelete = async () => { if (!(await confirmModal('Remove block', 'Remove this day off / blocked time?', 'Remove'))) return; try { await api.delUnavail(r.tech.id, u.id); toast('Block removed', 'success'); closeSchedPopover(); fetchSched(); } catch (e) { toast(e.message, 'error'); } };
  } else {
    const s = r.schedules.find((x) => String(x.id) === String(id)); if (!s) return;
    html = `<div class="pop-head"><span class="sched-dot dept-${dept}"></span><strong>${esc(r.tech.username)}</strong> ${deptTag(dept)}</div>
      <div class="pop-row"><span>Day</span><b>${DOW_FULL[s.day_of_week]}</b></div>
      <div class="pop-row"><span>Hours</span><b>${esc(s.start_time)}–${esc(s.end_time)}</b></div>
      <div class="pop-row"><span>Open tickets</span><b>${r.tech.workload}</b></div>
      <div class="pop-foot"><button class="btn-danger btn-sm" data-del>Delete hours</button></div>`;
    onDelete = async () => { if (!(await confirmModal('Remove working hours', 'Remove this working-hours block?', 'Remove'))) return; try { await api.delSchedule(r.tech.id, s.id); toast('Working hours removed', 'success'); closeSchedPopover(); fetchSched(); } catch (e) { toast(e.message, 'error'); } };
  }
  const pop = openSchedPopover(el, html);
  $('[data-del]', pop).addEventListener('click', onDelete);
}

// Lightweight confirm dialog → resolves true (confirmed) / false (cancelled)
function confirmModal(title, message, okLabel = 'Delete') {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (v) => { if (!settled) { settled = true; resolve(v); } };
    openModal({
      title,
      bodyHTML: `<p class="confirm-text">${esc(message)}</p>`,
      footHTML: `<button class="btn-ghost" data-cancel>Cancel</button><button class="btn-danger" data-ok>${esc(okLabel)}</button>`,
      onMount(ov, close) {
        $('[data-ok]', ov).addEventListener('click', () => { settle(true); close(); });
        $('[data-cancel]', ov).addEventListener('click', () => { settle(false); close(); });
      },
    });
  });
}

// ==========================================================================
// View: Reporting & Performance (managerial module)
// ==========================================================================
const REPORT_TABS = [
  ['summary', 'Executive Summary'],
  ['tech', 'Technician Performance'],
  ['outlet', 'Outlet / Region'],
  ['dept', 'Department'],
  ['sla', 'SLA Detail'],
  ['sched', 'On Scheduled'],
  ['insight', 'Manager Insights'],
];
const RANK_VIEWS = [
  ['assigned', 'Most assigned'],
  ['resolved', 'Most resolved'],
  ['fast', 'Fastest avg resolution'],
  ['sla', 'Highest SLA %'],
  ['overdue', 'Most SLA breaches'],
  ['workload', 'Highest workload'],
];
let _perf = null;         // last performance payload
let _reportTab = 'summary';
let _rankView = 'assigned';

// minutes → "2h 15m" / "1d 4h" / "35m" (mirrors backend fmtDuration)
function fmtMins(m) {
  if (m == null) return '—';
  if (m < 60) return m + 'm';
  if (m < 1440) { const h = Math.floor(m / 60), mm = m % 60; return mm ? `${h}h ${mm}m` : `${h}h`; }
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60); return h ? `${d}d ${h}h` : `${d}d`;
}
function slaBadge(s) {
  const cls = { 'Met': 'st-Resolved', 'Breached': 'st-Cancelled', 'At Risk': 'ur-High', 'Not Started': 'st-New', 'On Track': 'st-Open' }[s] || 'st-Assigned';
  return `<span class="badge ${cls}">${esc(s || '—')}</span>`;
}
const localISO = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

async function renderReports() {
  const showDept = ['SuperAdmin', 'Leader'].includes(state.user.role);
  let brands = [], outlets = [], techs = [], cats = [];
  try {
    [brands, outlets, techs, cats] = await Promise.all([
      api.brands().catch(() => []),
      (api.allOutlets ? api.allOutlets().catch(() => api.outlets()) : api.outlets()).catch(() => []),
      api.technicians().catch(() => []),
      (api.allCategories ? api.allCategories().catch(() => []) : Promise.resolve([])),
    ]);
  } catch (_) {}
  const catNames = [...new Set((cats || []).map((c) => c.name).filter(Boolean))].sort();
  const now = new Date();
  const monthStart = localISO(new Date(now.getFullYear(), now.getMonth(), 1));
  const today = localISO(now);

  view().innerHTML = `<div class="page-head"><h2>Reporting &amp; Performance</h2><p>Managerial performance — server-side &amp; permission-scoped${state.user.role !== 'SuperAdmin' ? ` · ${esc(state.user.department || state.user.role)} scope` : ''}</p></div>
    <div class="card mb no-print">
      <div class="field-row">
        <div class="field"><label>From</label><input type="date" id="r-from" value="${monthStart}"></div>
        <div class="field"><label>To</label><input type="date" id="r-to" value="${today}"></div>
        ${showDept ? `<div class="field"><label>Department</label><select id="r-dept"><option value="">All</option><option>IT</option><option>ME</option></select></div>` : ''}
        <div class="field"><label>Region</label><select id="r-region"><option value="">All</option>${REGIONS.map((r) => `<option>${esc(r)}</option>`).join('')}</select></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Brand</label><select id="r-brand"><option value="">All</option>${brands.map((b) => `<option>${esc(b.code)}</option>`).join('')}</select></div>
        <div class="field"><label>Outlet</label><select id="r-outlet"><option value="">All</option>${outlets.map((o) => `<option value="${esc(o.code)}">${esc(o.code)}</option>`).join('')}</select></div>
        <div class="field"><label>Technician</label><select id="r-tech"><option value="">All</option>${techs.map((t) => `<option>${esc(t.username)}</option>`).join('')}</select></div>
        <div class="field"><label>Category</label><select id="r-cat"><option value="">All</option>${catNames.map((c) => `<option>${esc(c)}</option>`).join('')}</select></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Status</label><select id="r-status"><option value="">All</option>${STATUSES.map((s) => `<option>${s}</option>`).join('')}</select></div>
        <div class="field"><label>Urgency</label><select id="r-urg"><option value="">All</option>${URGENCIES.map((s) => `<option>${s}</option>`).join('')}</select></div>
        <div class="field"><label>SLA status</label><select id="r-sla"><option value="">All</option>${['Met', 'Breached', 'At Risk', 'Not Started', 'On Track'].map((s) => `<option>${s}</option>`).join('')}</select></div>
        <div class="field"><label>Scheduled from</label><input type="date" id="r-sfrom"></div>
        <div class="field"><label>Scheduled to</label><input type="date" id="r-sto"></div>
      </div>
      <div class="row wrap gap-sm">
        <button class="btn-primary" id="r-run">Generate</button>
        <button class="btn-outline" id="r-csv-raw">CSV: tickets</button>
        <button class="btn-outline" id="r-csv-tech">CSV: technicians</button>
        <button class="btn-outline" id="r-csv-sla">CSV: SLA detail</button>
        <button class="btn-outline" id="r-print">Print</button>
      </div>
    </div>
    <div class="tabbar no-print" id="r-tabs">${REPORT_TABS.map(([k, l]) => `<button class="tab ${k === _reportTab ? 'active' : ''}" data-tab="${k}">${l}</button>`).join('')}</div>
    <div id="r-result"><div class="loading-inline">Generating report…</div></div>`;

  const params = () => {
    const q = new URLSearchParams();
    if (showDept && $('#r-dept') && $('#r-dept').value) q.append('department', $('#r-dept').value);
    const g = (id, key) => { const el = $(id); if (el && el.value) q.append(key, el.value); };
    g('#r-region', 'region'); g('#r-brand', 'brand'); g('#r-outlet', 'outlet');
    g('#r-tech', 'technician'); g('#r-cat', 'category'); g('#r-status', 'status');
    g('#r-urg', 'urgency'); g('#r-sla', 'sla_status');
    g('#r-from', 'start_date'); g('#r-to', 'end_date');
    g('#r-sfrom', 'scheduled_from'); g('#r-sto', 'scheduled_to');
    return q;
  };
  const run = async () => {
    if ($('#r-from').value && $('#r-to').value && $('#r-from').value > $('#r-to').value) { toast('Start date is after end date', 'error'); return; }
    $('#r-result').innerHTML = `<div class="loading-inline">Generating report…</div>`;
    const qs = params().toString();
    const url = '/api/reports/performance' + (qs ? '?' + qs : '');
    try {
      _perf = await api.performance(qs);
      drawReportTab();
      toast(`Report ready — ${_perf.summary.total} ticket(s)`, _perf.summary.total ? 'success' : 'info');
    } catch (e) {
      const status = e.status || '?';
      console.error(`[Reporting] ${url} failed — HTTP ${status}`, e);
      const hint = status === 404
        ? 'Reporting endpoint not found — the server may need to be restarted to load the latest routes.'
        : status === 403
          ? 'You do not have permission to view the performance report.'
          : (e.message || 'Please try again.');
      $('#r-result').innerHTML = `<div class="empty"><h3>Couldn’t load the report</h3><p>${esc(hint)}</p><p class="muted" style="font-size:.78rem">GET ${esc(url)} → HTTP ${esc(status)}</p></div>`;
      toast(`Report failed (HTTP ${status})`, 'error');
    }
  };
  $('#r-run').addEventListener('click', run);
  const openCsv = (kind) => { const q = params(); if (kind) q.append('export', kind); window.open('/api/reports/export?' + q.toString(), '_blank'); toast('Preparing CSV export…', 'info'); };
  $('#r-csv-raw').addEventListener('click', () => openCsv('raw'));
  $('#r-csv-tech').addEventListener('click', () => openCsv('technician'));
  $('#r-csv-sla').addEventListener('click', () => openCsv('sla'));
  $('#r-print').addEventListener('click', () => window.print());
  $$('#r-tabs .tab').forEach((b) => b.addEventListener('click', () => {
    _reportTab = b.dataset.tab;
    $$('#r-tabs .tab').forEach((x) => x.classList.toggle('active', x.dataset.tab === _reportTab));
    drawReportTab();
  }));
  await run();
}

function drawReportTab() {
  const box = $('#r-result'); if (!box || !_perf) return;
  const p = _perf;
  box.innerHTML = ({
    summary: () => reportSummary(p),
    tech: () => reportTechnicians(p),
    outlet: () => reportOutlets(p),
    dept: () => reportDepartments(p),
    sla: () => reportSlaDetail(p),
    sched: () => reportScheduled(p),
    insight: () => reportInsights(p),
  }[_reportTab] || (() => reportSummary(p)))();
  animateCounters(box);
  if (_reportTab === 'tech') {
    $$('#rank-view .tab').forEach((b) => b.addEventListener('click', () => {
      _rankView = b.dataset.rank;
      drawReportTab();
    }));
  }
}

function reportSummary(p) {
  const s = p.summary;
  return `<div class="panel"><div class="panel-head"><h3>Executive Summary</h3></div>
    <div class="stat-grid">
      ${statCard(s.total, 'Total tickets', 'primary')}
      ${statCard(s.new, 'New')}
      ${statCard(s.assigned, 'Assigned')}
      ${statCard(s.on_scheduled, 'On Scheduled')}
      ${statCard(s.on_progress, 'On Progress')}
      ${statCard(s.waiting_sparepart, 'Waiting Sparepart')}
      ${statCard(s.waiting_vendor, 'Waiting Vendor')}
      ${statCard(s.resolved, 'Resolved', 'ok')}
      ${statCard(s.closed, 'Closed')}
      ${statCard(s.cancelled, 'Cancelled')}
      ${statCard(s.sla_met, 'SLA met', 'ok')}
      ${statCard(s.sla_breached, 'SLA breached', 'danger')}
      ${statCard(s.sla_achievement != null ? s.sla_achievement + '%' : '—', 'SLA achievement', 'primary')}
      ${statCard(fmtMins(s.avg_first_response_mins), 'Avg first response')}
      ${statCard(fmtMins(s.avg_assign_mins), 'Avg assignment')}
      ${statCard(fmtMins(s.avg_start_mins), 'Avg time to start')}
      ${statCard(fmtMins(s.avg_resolution_mins), 'Avg resolution', 'ok')}
      ${statCard(fmtMins(s.avg_close_mins), 'Avg close')}
    </div>
    <div class="hint" style="padding:6px 4px">SLA targets — Critical ${fmtMins(p.targets.Critical)} · High ${fmtMins(p.targets.High)} · Medium ${fmtMins(p.targets.Medium)} · Low ${fmtMins(p.targets.Low)} (configurable).</div>
  </div>`;
}

function reportTechnicians(p) {
  const techs = [...p.technicians];
  const cmp = {
    assigned: (a, b) => b.assigned - a.assigned,
    resolved: (a, b) => b.resolved - a.resolved,
    fast: (a, b) => (a.avg_resolution_mins == null ? Infinity : a.avg_resolution_mins) - (b.avg_resolution_mins == null ? Infinity : b.avg_resolution_mins),
    sla: (a, b) => (b.sla_achievement == null ? -1 : b.sla_achievement) - (a.sla_achievement == null ? -1 : a.sla_achievement),
    overdue: (a, b) => b.sla_breached - a.sla_breached,
    workload: (a, b) => b.open_workload - a.open_workload,
  }[_rankView] || ((a, b) => b.assigned - a.assigned);
  techs.sort(cmp);
  const rankBar = `<div class="tabbar" id="rank-view">${RANK_VIEWS.map(([k, l]) => `<button class="tab ${k === _rankView ? 'active' : ''}" data-rank="${k}">${l}</button>`).join('')}</div>`;
  const rows = techs.map((t) => `<tr>
    <td><strong>${esc(t.technician)}</strong></td>
    <td>${deptTag(t.department)}</td>
    <td>${esc(t.pic_area || t.region || '—')}</td>
    <td class="num">${t.coverage != null ? t.coverage : '—'}</td>
    <td class="num">${t.assigned}</td>
    <td class="num">${t.resolved}</td>
    <td class="num">${t.open_workload}</td>
    <td class="num">${fmtMins(t.avg_first_response_mins)}</td>
    <td class="num">${fmtMins(t.avg_start_mins)}</td>
    <td class="num">${fmtMins(t.avg_resolution_mins)}</td>
    <td class="num">${t.sla_met}</td>
    <td class="num">${t.sla_breached}</td>
    <td class="num">${t.sla_achievement != null ? t.sla_achievement + '%' : '—'}</td>
    <td class="num">${t.waiting}</td>
    <td class="num">${t.scheduled_not_started}</td>
  </tr>`).join('');
  return `<div class="panel"><div class="panel-head"><h3>Technician Performance</h3></div>
    ${rankBar}
    <div class="table-wrap"><table class="data">
      <thead><tr><th>Technician</th><th>Dept</th><th>PIC area</th><th>Coverage</th><th>Assigned</th><th>Resolved</th><th>Open</th><th>Avg 1st resp</th><th>Avg start</th><th>Avg resolve</th><th>SLA met</th><th>SLA breach</th><th>SLA %</th><th>Waiting</th><th>Sched n/started</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="15" class="muted" style="text-align:center;padding:16px">No technicians in scope</td></tr>'}</tbody>
    </table></div>
  </div>`;
}

function reportOutlets(p) {
  const outletRows = p.outlets.map((o) => `<tr><td><strong>${esc(o.outlet)}</strong></td><td class="num">${o.total}</td><td class="num">${o.sla_breached}</td><td class="num">${fmtMins(o.avg_resolution_mins)}</td><td class="num">${o.recurring || 0}</td></tr>`).join('');
  const regionRows = p.regions.map((r) => `<tr><td>${esc(r.region)}</td><td class="num">${r.total}</td><td class="num">${r.sla_breached}</td><td class="num">${fmtMins(r.avg_resolution_mins)}</td></tr>`).join('');
  const brandRows = p.brands.map((b) => `<div class="dist-row"><span>${esc(b.brand)}</span><strong>${b.total}</strong></div>`).join('') || '<p class="muted">No data</p>';
  const catRows = p.categories.slice(0, 12).map((c) => `<div class="dist-row"><span>${deptTag(c.department)} ${esc(c.category)}</span><strong>${c.total}</strong></div>`).join('') || '<p class="muted">No data</p>';
  const recRows = p.recurring.slice(0, 12).map((r) => `<div class="dist-row"><span>${esc(r.outlet)} · ${esc(r.category)}</span><strong>${r.count}×</strong></div>`).join('') || '<p class="muted">No repeated same-category issues</p>';
  return `<div class="panel"><div class="panel-head"><h3>Region performance</h3></div><div class="table-wrap"><table class="data">
      <thead><tr><th>Region</th><th>Tickets</th><th>SLA breaches</th><th>Avg resolution</th></tr></thead>
      <tbody>${regionRows || '<tr><td colspan="4" class="muted">No data</td></tr>'}</tbody></table></div></div>
    <div class="panel mt"><div class="panel-head"><h3>Most problematic outlets</h3></div><div class="table-wrap"><table class="data">
      <thead><tr><th>Outlet</th><th>Tickets</th><th>SLA breaches</th><th>Avg resolution</th><th>Worst recurring</th></tr></thead>
      <tbody>${outletRows || '<tr><td colspan="5" class="muted">No data</td></tr>'}</tbody></table></div></div>
    <div class="grid-2 mt">
      <div class="panel"><div class="panel-head"><h3>By brand</h3></div><div class="card" style="border:none">${brandRows}</div></div>
      <div class="panel"><div class="panel-head"><h3>Recurring issues (outlet · category)</h3></div><div class="card" style="border:none">${recRows}</div></div>
    </div>
    <div class="panel mt"><div class="panel-head"><h3>Recurring categories</h3></div><div class="card" style="border:none">${catRows}</div></div>`;
}

function reportDepartments(p) {
  const rows = p.departments.map((d) => `<tr>
    <td>${deptTag(d.department)}</td>
    <td class="num">${d.total}</td>
    <td class="num">${d.backlog}</td>
    <td class="num">${fmtMins(d.avg_resolution_mins)}</td>
    <td class="num">${d.sla_achievement != null ? d.sla_achievement + '%' : '—'}</td>
    <td class="num">${d.waiting}</td>
    <td class="num">${d.on_scheduled}</td>
    <td class="num">${d.technicians}</td>
  </tr>`).join('');
  return `<div class="panel"><div class="panel-head"><h3>Department Performance — IT vs ME</h3></div><div class="table-wrap"><table class="data">
    <thead><tr><th>Dept</th><th>Volume</th><th>Backlog</th><th>Avg resolution</th><th>SLA %</th><th>Waiting</th><th>On Scheduled</th><th>Technicians</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="8" class="muted">No data</td></tr>'}</tbody></table></div></div>`;
}

function reportSlaDetail(p) {
  const rows = p.tickets.map((t) => `<tr>
    <td class="nowrap">${esc(t.ticket_number)}</td>
    <td class="nowrap">${fmtDate(t.created_at)}</td>
    <td>${esc(t.region || '—')}</td>
    <td>${esc(t.brand_code || '—')}</td>
    <td>${esc(t.outlet_display || t.outlet_code || '—')}</td>
    <td>${deptTag(t.department)}</td>
    <td>${esc(t.category || '')}</td>
    <td>${urgBadge(t.urgency)}</td>
    <td>${badge(t.status)}</td>
    <td>${esc(t.assignee_name || '')}</td>
    <td class="nowrap">${fmtDate(t.assigned_at)}</td>
    <td class="nowrap">${fmtDate(t.started_at)}</td>
    <td class="nowrap">${fmtDate(t.resolved_at)}</td>
    <td class="nowrap">${fmtDate(t.closed_at)}</td>
    <td class="nowrap">${fmtDate(t.sla_deadline_at)}</td>
    <td>${slaBadge(t.sla_status)}</td>
    <td class="num">${t.breach_minutes ? fmtMins(t.breach_minutes) : '—'}</td>
    <td class="num">${fmtMins(t.aging_minutes)}</td>
  </tr>`).join('');
  return `<div class="panel"><div class="panel-head"><h3>SLA Detail — ${p.tickets.length} ticket(s)</h3></div><div class="table-wrap"><table class="data">
    <thead><tr><th>Ticket</th><th>Created</th><th>Region</th><th>Brand</th><th>Outlet</th><th>Dept</th><th>Category</th><th>Urg</th><th>Status</th><th>Technician</th><th>Assigned</th><th>Started</th><th>Resolved</th><th>Closed</th><th>SLA deadline</th><th>SLA status</th><th>Breach</th><th>Aging</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="18" class="muted" style="text-align:center;padding:16px">No matching tickets</td></tr>'}</tbody></table></div></div>`;
}

function reportScheduled(p) {
  const sc = p.scheduled;
  const list = sc.list.map((r) => `<tr>
    <td class="nowrap">${esc(r.ticket_number)}</td>
    <td>${esc(r.outlet || '—')}</td>
    <td>${esc(r.region || '—')}</td>
    <td>${esc(r.category || '')}</td>
    <td>${r.technician ? esc(r.technician) : '<span class="muted">Unassigned</span>'}</td>
    <td class="nowrap">${fmtDate(r.scheduled_at)}</td>
    <td class="nowrap">${fmtDate(r.scheduled_end)}</td>
    <td>${r.started ? '<span class="badge st-Resolved">Started</span>' : '<span class="badge st-New">Not started</span>'}</td>
  </tr>`).join('');
  return `<div class="panel"><div class="panel-head"><h3>On Scheduled Monitoring</h3></div>
    <div class="stat-grid">
      ${statCard(sc.total, 'On Scheduled total', 'primary')}
      ${statCard(sc.today, 'Scheduled today')}
      ${statCard(sc.this_week, 'Scheduled this week')}
      ${statCard(sc.overdue, 'Overdue', 'danger')}
      ${statCard(sc.not_started, 'Not started', 'warn')}
      ${statCard(sc.not_assigned, 'Not assigned', 'danger')}
    </div>
    <div class="table-wrap"><table class="data">
      <thead><tr><th>Ticket</th><th>Outlet</th><th>Region</th><th>Category</th><th>Technician</th><th>Scheduled start</th><th>Scheduled end</th><th>Execution</th></tr></thead>
      <tbody>${list || '<tr><td colspan="8" class="muted" style="text-align:center;padding:16px">No scheduled tickets in scope</td></tr>'}</tbody>
    </table></div>
  </div>`;
}

function reportInsights(p) {
  const ins = p.insights || { summary: '', bullets: [] };
  return `<div class="panel"><div class="panel-head"><h3>Manager Insights</h3></div>
    <div class="insight-brief">${esc(ins.summary)}</div>
    <ul class="insight-list">${ins.bullets.map((b) => `<li>${esc(b)}</li>`).join('') || '<li class="muted">No notable highlights for this selection.</li>'}</ul>
    <div class="hint" style="padding:6px 4px">Generated from the current filters. Adjust the filters and re-generate to update this briefing.</div>
  </div>`;
}

// ==========================================================================
// View: Users (SuperAdmin: all users · AdminIT: IT-side users only)
// ==========================================================================
async function renderUsers() {
  view().innerHTML = `<div class="page-head"><h2>Users</h2><p>Manage staff, roles & access</p></div>
    <div class="toolbar"><div class="search"><input id="u-search" placeholder="Search name / email…"></div><button class="btn-primary" id="u-add">+ Add user</button></div>
    <div class="panel"><div class="table-wrap"><table class="data"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Dept</th><th>Access</th><th>Status</th><th></th></tr></thead><tbody id="u-body"><tr><td colspan="7" class="loading-inline">Loading…</td></tr></tbody></table></div></div>`;
  let all = [];
  const draw = (term = '') => {
    const rows = all
      .filter((u) => canManageTargetRole(state.user.role, u.role))
      .filter((u) => !term || u.username.toLowerCase().includes(term) || u.email.toLowerCase().includes(term));
    $('#u-body').innerHTML = rows.length ? rows.map(userRow).join('') : '<tr><td colspan="7" class="muted" style="text-align:center;padding:20px">No users</td></tr>';
    $$('[data-edit]').forEach((b) => b.addEventListener('click', () => openUserModal(all.find((x) => x.id == b.dataset.edit), reload)));
    $$('[data-del]').forEach((b) => b.addEventListener('click', () => confirmDeleteUser(all.find((x) => x.id == b.dataset.del), reload)));
  };
  const reload = async () => { all = await api.users(); draw($('#u-search').value.trim().toLowerCase()); };
  $('#u-add').addEventListener('click', () => openUserModal(null, reload));
  $('#u-search').addEventListener('input', debounce((e) => draw(e.target.value.trim().toLowerCase()), 200));
  try { await reload(); } catch (e) { $('#u-body').innerHTML = `<tr><td colspan="7">${errBox(e)}</td></tr>`; }
}
function userRow(u) {
  const self = state.user.id === u.id;
  let access = u.all_brands ? 'All brands' : (u.brand || '—');
  if (u.all_outlets) access += ' · all outlets';
  else if (u.outlet_access && u.outlet_access.length) access += ` · ${u.outlet_access.length} PIC outlet(s)`;
  if (u.region) access += ` · ${u.region}`;
  return `<tr>
    <td><strong>${esc(u.username)}</strong> ${self ? '<span class="muted">(you)</span>' : ''}</td>
    <td>${esc(u.email)}</td><td>${esc(u.role)}</td><td>${esc(u.department || '—')}</td>
    <td>${esc(access)}</td>
    <td>${u.is_active ? '<span class="badge st-Resolved">Active</span>' : '<span class="badge st-Cancelled">Inactive</span>'}</td>
    <td class="nowrap"><button class="btn-ghost" data-edit="${u.id}" style="padding:6px 8px">Edit</button>${self ? '' : `<button class="btn-ghost" data-del="${u.id}" style="padding:6px 8px;color:var(--danger)">Del</button>`}</td>
  </tr>`;
}
const ALL_ROLES = ['Requestor', 'TechnicianIT', 'TechnicianME', 'AdminIT', 'AdminME', 'Leader', 'SuperAdmin'];
// UX mirror of the backend RBAC (src/utils/permissions.js). AdminIT is scoped to
// IT-side roles; SuperAdmin manages everyone. The server re-enforces this — these
// helpers only shape the UI (list rows + role dropdown), never grant access.
const ADMINIT_MANAGEABLE_ROLES = ['Requestor', 'TechnicianIT', 'AdminIT', 'Leader'];
function canManageTargetRole(currentRole, targetRole) {
  if (currentRole === 'SuperAdmin') return true;
  if (currentRole === 'AdminIT') return ADMINIT_MANAGEABLE_ROLES.includes(targetRole);
  return false;
}
function assignableRoles() {
  return ALL_ROLES.filter((r) => canManageTargetRole(state.user.role, r));
}
async function openUserModal(u, after) {
  const isEdit = !!u;
  // Load reference data for the dropdowns (brands + outlets for PIC coverage).
  let brands = [], outlets = [];
  try { [brands, outlets] = await Promise.all([api.brands(), api.allOutlets().catch(() => api.outlets())]); }
  catch (_) {}
  const brandOptions = [{ value: '', label: '— None —' }, ...brands.map((b) => ({ value: b.code, label: `${b.code} — ${b.name}` }))];
  const regionOptions = [{ value: '', label: '— None —' }, ...REGIONS.map((r) => ({ value: r, label: r }))];
  const outletOptions = outlets.map((o) => ({ value: o.code, label: `${o.code}${o.region ? ' · ' + o.region : ''} (${o.brand_code})` }));

  const isAdminOrSuper = ['SuperAdmin', 'AdminIT', 'AdminME'].includes(state.user ? state.user.role : '');

  const fields = [
    { name: 'username', label: 'Full name', required: !isEdit, value: u ? u.username : '' },
    { name: 'email', label: 'Email', type: 'email', required: !isEdit, value: u ? u.email : '' },
    { name: 'role', label: 'Role', type: 'select', value: u ? u.role : 'Requestor', options: assignableRoles().map((r) => ({ value: r, label: r })) },
    { name: 'brand', label: 'Brand', type: 'select', value: u ? (u.brand || '') : '', options: brandOptions, hint: 'Single brand access (leave None for requestors or all-brand staff).' },
    { name: 'all_brands', label: '', type: 'checkbox', checkboxLabel: 'All-brand access', value: u ? !!u.all_brands : false },
    { name: 'region', label: 'Region', type: 'select', value: u ? (u.region || '') : '', options: regionOptions },
    { name: 'pic_area', label: 'PIC area (technician label, optional)', value: u ? (u.pic_area || '') : '', placeholder: 'e.g. IT Area 1' },
    ...(isAdminOrSuper ? [
      { name: 'outlet_access', label: 'PIC outlet coverage (technician scope)', type: 'multiselect', value: u ? (u.outlet_access || []) : [], options: outletOptions, hint: 'Tickets from these outlets appear in the technician default list.' },
      { name: 'all_outlets', label: '', type: 'checkbox', checkboxLabel: 'All-outlet access (technician can see whole department)', value: u ? !!u.all_outlets : false },
    ] : []),
    { name: 'can_close_override', label: '', type: 'checkbox', checkboxLabel: 'Technician may close tickets', value: u ? !!u.can_close_override : false },
    { name: 'is_active', label: '', type: 'checkbox', checkboxLabel: 'Active', value: u ? !!u.is_active : true },
    { name: 'password', label: isEdit ? 'New password (blank = keep)' : 'Password', type: 'password', required: !isEdit, hint: 'Min 10 chars, upper/lower/number/special' },
  ];

  const v = await formModal(isEdit ? 'Edit user' : 'Add user', fields, isEdit ? 'Save' : 'Create');
  if (!v) return;
  const payload = {
    username: v.username, email: v.email, role: v.role,
    brand: v.brand || null, all_brands: v.all_brands,
    region: v.region || null, pic_area: v.pic_area || null,
    can_close_override: v.can_close_override, is_active: v.is_active,
  };
  if (isAdminOrSuper) {
    payload.outlet_access = v.outlet_access || [];
    payload.all_outlets = !!v.all_outlets;
  }
  if (v.password) payload.password = v.password;
  try {
    if (isEdit) await api.patchUser(u.id, payload); else await api.createUser(payload);
    toast(isEdit ? 'User updated' : 'User created', 'success'); after();
  } catch (e) { toast(e.message, 'error'); }
}
async function confirmDeleteUser(u, after) {
  const v = await formModal('Delete ' + u.username + '?', [{ name: 'c', label: '', type: 'checkbox', checkboxLabel: 'Yes, permanently delete this user', value: false }], 'Delete');
  if (!v || !v.c) return;
  try { await api.delUser(u.id); toast('User deleted', 'success'); after(); } catch (e) { toast(e.message, 'error'); }
}

// ==========================================================================
// View: Categories (Admin Category Creation & Management Menu)
// ==========================================================================
async function renderCategories() {
  view().innerHTML = `
    <div class="page-head">
      <h2>Category Management</h2>
      <p>Create and manage categories for IT and Mechanical departments</p>
    </div>
    <div class="toolbar">
      <div class="search">
        <input id="cat-search" placeholder="Search category name…">
      </div>
      <button class="btn-primary" id="cat-add">+ Add category</button>
    </div>
    <div class="panel">
      <div class="table-wrap">
        <table class="data">
          <thead>
            <tr>
              <th>Category Name</th>
              <th>Department</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="cat-body">
            <tr><td colspan="4" class="loading-inline">Loading…</td></tr>
          </tbody>
        </table>
      </div>
    </div>`;

  let all = [];
  const draw = (term = '') => {
    const rows = all.filter((c) => 
      !term || c.name.toLowerCase().includes(term) || c.department_code.toLowerCase().includes(term)
    );
    const tbody = $('#cat-body');
    if (!tbody) return;
    tbody.innerHTML = rows.length ? rows.map(categoryRow).join('') : '<tr><td colspan="4" class="muted" style="text-align:center;padding:20px">No categories found</td></tr>';
    
    // Bind actions
    $$('[data-edit-cat]').forEach((b) => b.addEventListener('click', () => openCategoryModal(all.find((x) => x.id == b.dataset.editCat), reload)));
    $$('[data-toggle-cat]').forEach((b) => b.addEventListener('click', () => toggleCategoryActive(all.find((x) => x.id == b.dataset.toggleCat), reload)));
    $$('[data-del-cat]').forEach((b) => b.addEventListener('click', () => confirmDeleteCategory(all.find((x) => x.id == b.dataset.delCat), reload)));
  };

  const reload = async () => {
    try {
      all = await api.allCategories();
      draw($('#cat-search').value.trim().toLowerCase());
    } catch (e) {
      const tbody = $('#cat-body');
      if (tbody) tbody.innerHTML = `<tr><td colspan="4">${errBox(e)}</td></tr>`;
    }
  };

  $('#cat-add').addEventListener('click', () => openCategoryModal(null, reload));
  $('#cat-search').addEventListener('input', debounce((e) => draw(e.target.value.trim().toLowerCase()), 200));
  
  try {
    await reload();
  } catch (e) {
    const tbody = $('#cat-body');
    if (tbody) tbody.innerHTML = `<tr><td colspan="4">${errBox(e)}</td></tr>`;
  }
}

function categoryRow(c) {
  const statusBadge = c.active ? '<span class="badge st-Resolved">Active</span>' : '<span class="badge st-Cancelled">Inactive</span>';
  const toggleLabel = c.active ? 'Deactivate' : 'Activate';
  const toggleClass = c.active ? 'color:var(--warn)' : 'color:var(--ok)';
  return `
    <tr>
      <td><strong>${esc(c.name)}</strong></td>
      <td>${deptTag(c.department_code)}</td>
      <td>${statusBadge}</td>
      <td class="nowrap">
        <button class="btn-ghost" data-edit-cat="${c.id}" style="padding:6px 8px">Edit</button>
        <button class="btn-ghost" data-toggle-cat="${c.id}" style="padding:6px 8px;${toggleClass}">${toggleLabel}</button>
        <button class="btn-ghost" data-del-cat="${c.id}" style="padding:6px 8px;color:var(--danger)">Del</button>
      </td>
    </tr>`;
}

async function openCategoryModal(c, after) {
  const isEdit = !!c;
  const v = await formModal(isEdit ? 'Edit Category' : 'Add Category', [
    { 
      name: 'department_code', 
      label: 'Category Type (Department)', 
      type: 'select', 
      value: c ? c.department_code : 'IT', 
      options: [
        { value: 'IT', label: 'IT' },
        { value: 'ME', label: 'Mechanical' }
      ] 
    },
    { 
      name: 'name', 
      label: 'Category Name', 
      required: true, 
      value: c ? c.name : '', 
      placeholder: 'e.g. Network Outage or HVAC Repair' 
    },
    {
      name: 'sort_order',
      label: 'Sort Order',
      type: 'number',
      value: c ? String(c.sort_order) : '0'
    }
  ], isEdit ? 'Save' : 'Create');
  
  if (!v) return;
  const payload = {
    department_code: v.department_code,
    name: v.name,
    sort_order: Number(v.sort_order) || 0
  };
  
  try {
    if (isEdit) {
      await api.patchCategory(c.id, payload);
      toast('Category updated', 'success');
    } else {
      await api.createCategory(payload);
      toast('Category created', 'success');
    }
    after();
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function toggleCategoryActive(c, after) {
  try {
    await api.patchCategory(c.id, { active: !c.active });
    toast(`Category ${c.active ? 'deactivated' : 'activated'}`, 'success');
    after();
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function confirmDeleteCategory(c, after) {
  const v = await formModal('Delete Category: ' + c.name + '?', [
    { 
      name: 'confirm', 
      label: '', 
      type: 'checkbox', 
      checkboxLabel: 'Yes, permanently delete this category', 
      value: false 
    }
  ], 'Delete');
  
  if (!v || !v.confirm) return;
  try {
    await api.deleteCategory(c.id);
    toast('Category deleted', 'success');
    after();
  } catch (e) {
    toast(e.message, 'error');
  }
}

// ==========================================================================
// View: Locations (Admin Location Creation & Management Menu)
// ==========================================================================
async function renderLocations() {
  view().innerHTML = `
    <div class="page-head">
      <h2>Location Management</h2>
      <p>Create and manage outlet locations and their associated brands</p>
    </div>
    <div class="toolbar">
      <div class="search">
        <input id="loc-search" placeholder="Search outlet code, name or brand…">
      </div>
      <button class="btn-primary" id="loc-add">+ Add location</button>
    </div>
    <div class="panel">
      <div class="table-wrap">
        <table class="data">
          <thead>
            <tr>
              <th>Outlet Code</th>
              <th>Outlet Name</th>
              <th>Brand</th>
              <th>Region</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="loc-body">
            <tr><td colspan="6" class="loading-inline">Loading…</td></tr>
          </tbody>
        </table>
      </div>
    </div>`;

  let all = [];
  const draw = (term = '') => {
    const rows = all.filter((o) => 
      !term || 
      o.code.toLowerCase().includes(term) || 
      o.name.toLowerCase().includes(term) || 
      o.brand_code.toLowerCase().includes(term)
    );
    const tbody = $('#loc-body');
    if (!tbody) return;
    tbody.innerHTML = rows.length ? rows.map(outletRow).join('') : '<tr><td colspan="6" class="muted" style="text-align:center;padding:20px">No locations found</td></tr>';
    
    // Bind actions
    $$('[data-edit-loc]').forEach((b) => b.addEventListener('click', () => openOutletModal(all.find((x) => x.id == b.dataset.editLoc), reload)));
    $$('[data-toggle-loc]').forEach((b) => b.addEventListener('click', () => toggleOutletActive(all.find((x) => x.id == b.dataset.toggleLoc), reload)));
    $$('[data-del-loc]').forEach((b) => b.addEventListener('click', () => confirmDeleteOutlet(all.find((x) => x.id == b.dataset.delLoc), reload)));
  };

  const reload = async () => {
    try {
      all = await api.allOutlets();
      draw($('#loc-search').value.trim().toLowerCase());
    } catch (e) {
      const tbody = $('#loc-body');
      if (tbody) tbody.innerHTML = `<tr><td colspan="6">${errBox(e)}</td></tr>`;
    }
  };

  $('#loc-add').addEventListener('click', () => openOutletModal(null, reload));
  $('#loc-search').addEventListener('input', debounce((e) => draw(e.target.value.trim().toLowerCase()), 200));
  
  try {
    await reload();
  } catch (e) {
    const tbody = $('#loc-body');
    if (tbody) tbody.innerHTML = `<tr><td colspan="6">${errBox(e)}</td></tr>`;
  }
}

function outletRow(o) {
  const statusBadge = o.active ? '<span class="badge st-Resolved">Active</span>' : '<span class="badge st-Cancelled">Inactive</span>';
  const toggleLabel = o.active ? 'Deactivate' : 'Activate';
  const toggleClass = o.active ? 'color:var(--warn)' : 'color:var(--ok)';
  return `
    <tr>
      <td><strong>${esc(o.code)}</strong></td>
      <td>${esc(o.name)}</td>
      <td><span class="badge" style="background:var(--surface-2);color:var(--text);border:1px solid var(--border)">${esc(o.brand_code)}</span></td>
      <td>${esc(o.region || 'Jakarta')}</td>
      <td>${statusBadge}</td>
      <td class="nowrap">
        <button class="btn-ghost" data-edit-loc="${o.id}" style="padding:6px 8px">Edit</button>
        <button class="btn-ghost" data-toggle-loc="${o.id}" style="padding:6px 8px;${toggleClass}">${toggleLabel}</button>
        <button class="btn-ghost" data-del-loc="${o.id}" style="padding:6px 8px;color:var(--danger)">Del</button>
      </td>
    </tr>`;
}

async function openOutletModal(o, after) {
  const isEdit = !!o;
  let brands = [];
  try {
    brands = await api.brands();
  } catch (_) {}

  // Allow choosing from existing brands, or adding/typing a brand
  const brandOptions = brands.map(b => ({ value: b.code, label: b.name }));
  
  const v = await formModal(isEdit ? 'Edit Location' : 'Add Location', [
    {
      name: 'brand_code',
      label: 'Brand',
      type: 'select',
      value: o ? o.brand_code : (brandOptions[0] ? brandOptions[0].value : ''),
      options: brandOptions
    },
    {
      name: 'custom_brand_code',
      label: 'New Brand Code (Optional — use if brand is not in list above)',
      type: 'text',
      placeholder: 'e.g. UNION'
    },
    {
      name: 'code',
      label: 'Outlet Code (Unique short code)',
      required: true,
      value: o ? o.code : '',
      placeholder: 'e.g. UTP'
    },
    {
      name: 'name',
      label: 'Outlet Name',
      required: true,
      value: o ? o.name : '',
      placeholder: 'e.g. Union Plaza'
    },
    {
      name: 'display_label',
      label: 'Display Label (Optional — defaults to name)',
      value: o ? (o.display_label || '') : '',
      placeholder: 'e.g. Union Plaza'
    },
    {
      name: 'region',
      label: 'Region',
      type: 'select',
      value: o ? (o.region || 'Jakarta') : 'Jakarta',
      options: REGIONS.map((r) => ({ value: r, label: r }))
    }
  ], isEdit ? 'Save' : 'Create');

  if (!v) return;

  // Derive brand_code (if custom_brand_code is filled, use it)
  const brandCode = (v.custom_brand_code.trim() || v.brand_code).trim().toUpperCase();
  if (!brandCode) {
    toast('Brand is required', 'error');
    return;
  }

  const payload = {
    brand_code: brandCode,
    code: v.code.trim().toUpperCase(),
    name: v.name.trim(),
    display_label: (v.display_label.trim() || v.name.trim()),
    region: v.region || 'Jakarta'
  };

  try {
    if (isEdit) {
      await api.patchOutlet(o.id, payload);
      toast('Location updated', 'success');
    } else {
      await api.createOutlet(payload);
      toast('Location created', 'success');
    }
    after();
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function toggleOutletActive(o, after) {
  try {
    await api.patchOutlet(o.id, { active: !o.active });
    toast(`Location ${o.active ? 'deactivated' : 'activated'}`, 'success');
    after();
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function confirmDeleteOutlet(o, after) {
  const v = await formModal('Delete Location: ' + o.name + '?', [
    { 
      name: 'confirm', 
      label: '', 
      type: 'checkbox', 
      checkboxLabel: 'Yes, permanently delete this location', 
      value: false 
    }
  ], 'Delete');
  
  if (!v || !v.confirm) return;
  try {
    await api.deleteOutlet(o.id);
    toast('Location deleted', 'success');
    after();
  } catch (e) {
    toast(e.message, 'error');
  }
}

// ==========================================================================
// Quick / detailed report modal
// ==========================================================================
let quickUploader = null;
async function openReportModal() {
  const outlets = await api.outlets().catch(() => []);
  const brandsGroups = {};
  outlets.forEach((o) => { (brandsGroups[o.brand_code] = brandsGroups[o.brand_code] || []).push(o); });
  const lastOutlet = localStorage.getItem('lastOutlet') || '';
  const optgroups = Object.entries(brandsGroups).map(([b, list]) => `<optgroup label="${esc(b)}">${list.map((o) => `<option value="${esc(o.code)}" ${o.code === lastOutlet ? 'selected' : ''}>${esc(o.code)}</option>`).join('')}</optgroup>`).join('');
  const isAdmin = ADMIN_ROLES.includes(state.user.role);
  const body = `
    <div class="field"><label>Nama Requestor <span class="req-star">*</span></label><input id="q-reqname" placeholder="Name of requestor" value="${esc(state.user ? state.user.username : '')}"></div>
    <div class="field"><label>Outlet / Location <span class="req-star">*</span></label><select id="q-outlet"><option value="">Select outlet…</option>${optgroups}</select></div>
    <div class="field"><label>Department <span class="req-star">*</span></label>
      <div class="segmented"><button type="button" class="seg-btn big" data-dept="IT">🖥️ IT</button><button type="button" class="seg-btn big" data-dept="ME">🔧 Mechanical</button></div></div>
    <div class="field"><label>Category <span class="req-star">*</span></label><select id="q-cat" disabled><option>Select department first</option></select></div>
    <div id="q-event" hidden>
      <div class="field-row">
        <div class="field"><label>Scheduled start (event)</label><input type="datetime-local" id="q-sched"></div>
        <div class="field"><label>Scheduled end (optional)</label><input type="datetime-local" id="q-sched-end"></div>
      </div>
      <div class="hint">For Event tickets (e.g. printer setup, on-site standby) set the planned date/time. Admin can confirm as “On Scheduled” after review.</div>
    </div>
    <div class="field"><label>What’s the issue? <span class="req-star">*</span></label><textarea id="q-desc" placeholder="e.g. POS terminal 2 not printing receipts"></textarea></div>
    <div class="field"><label>Urgency</label><div class="segmented" id="q-urg">${URGENCIES.map((u) => `<button type="button" class="seg-btn ${u === 'Medium' ? 'active' : ''}" data-urg="${u}">${u}</button>`).join('')}</div></div>
    <div class="field"><label>Contact / WhatsApp</label><input id="q-contact" placeholder="08xx…" inputmode="tel"></div>
    ${isAdmin ? `<div class="field"><label>Report on behalf of email (optional)</label><div class="field-row"><input id="q-cemail" placeholder="Email" type="email"></div></div>` : ''}
    <button type="button" class="btn-ghost" id="q-more">▾ Add more details (optional)</button>
    <div id="q-extra" hidden>
      <div class="field"><label>Subject (optional)</label><input id="q-title" placeholder="Short subject line"></div>
      <div class="field-row"><div class="field"><label>Location in outlet</label><input id="q-loc"></div><div class="field"><label>Device / equipment</label><input id="q-dev"></div></div>
      <div class="field"><label>Business impact</label><input id="q-impact" placeholder="e.g. cannot take payments"></div>
      <div class="field-row"><div class="field"><label>When it happened</label><input type="datetime-local" id="q-occ"></div><div class="field"><label>Preferred visit time</label><input id="q-visit" placeholder="e.g. after 2pm"></div></div>
    </div>
    <div class="field mt"><label>Photos / video (optional)</label>${uploadZoneHTML('q-up')}</div>`;
  const foot = `<button class="btn-ghost" data-cancel>Cancel</button><button class="btn-primary" id="q-submit">Submit report</button>`;
  const { overlay, close } = openModal({
    title: 'Report an issue', bodyHTML: body, footHTML: foot, size: 'lg',
    onMount(ov, close) {
      quickUploader = new Uploader($('#q-up', ov), $('#q-up-list', ov));
      let dept = '';
      $$('[data-dept]', ov).forEach((b) => b.addEventListener('click', async () => {
        dept = b.dataset.dept;
        $$('[data-dept]', ov).forEach((x) => x.classList.toggle('active', x === b));
        const sel = $('#q-cat', ov); sel.disabled = true; sel.innerHTML = '<option>Loading…</option>';
        try { const cats = await api.categories(dept); sel.innerHTML = '<option value="">Select category…</option>' + cats.map((c) => `<option value="${esc(c.name)}">${esc(c.name)}</option>`).join(''); sel.disabled = false; }
        catch (e) { sel.innerHTML = '<option>Failed to load</option>'; }
      }));
      // Reveal scheduled date/time fields when the Event category is chosen.
      $('#q-cat', ov).addEventListener('change', (e) => {
        const ev = $('#q-event', ov); if (ev) ev.hidden = e.target.value !== 'Event';
      });
      let urg = 'Medium';
      $$('[data-urg]', ov).forEach((b) => b.addEventListener('click', () => { urg = b.dataset.urg; $$('[data-urg]', ov).forEach((x) => x.classList.toggle('active', x === b)); }));
      $('#q-more', ov).addEventListener('click', () => { const e = $('#q-extra', ov); e.hidden = !e.hidden; $('#q-more', ov).textContent = (e.hidden ? '▾ Add more details (optional)' : '▴ Hide extra details'); });
      $('[data-cancel]', ov).addEventListener('click', close);
      const submit = $('#q-submit', ov);
      submit.addEventListener('click', async () => {
        const reqName = $('#q-reqname', ov).value.trim();
        const outlet = $('#q-outlet', ov).value, cat = $('#q-cat', ov).value, desc = $('#q-desc', ov).value.trim();
        if (!reqName) return toast('Nama Requestor is required', 'error');
        if (!outlet) return toast('Select an outlet', 'error');
        if (!dept) return toast('Choose IT or Mechanical', 'error');
        if (!cat) return toast('Select a category', 'error');
        if (!desc) return toast('Describe the issue', 'error');
        if (quickUploader.uploading()) return toast('Wait for uploads to finish', 'error');
        submit.disabled = true; submit.textContent = 'Submitting…';
        const payload = {
          requestor_name: reqName, customer_name: reqName,
          department: dept, outlet_code: outlet, category: cat, description: desc, urgency: urg,
          contact_number: $('#q-contact', ov).value.trim(), report_mode: $('#q-extra', ov).hidden ? 'quick' : 'detailed',
          attachmentIds: quickUploader.ids(),
          title: ($('#q-title', ov) && $('#q-title', ov).value.trim()) || '',
          location_detail: $('#q-loc', ov) ? $('#q-loc', ov).value.trim() : '',
          device_equipment: $('#q-dev', ov) ? $('#q-dev', ov).value.trim() : '',
          business_impact: $('#q-impact', ov) ? $('#q-impact', ov).value.trim() : '',
          occurrence_at: $('#q-occ', ov) ? $('#q-occ', ov).value : '',
          preferred_visit_time: $('#q-visit', ov) ? $('#q-visit', ov).value.trim() : '',
          scheduled_at: $('#q-sched', ov) ? $('#q-sched', ov).value : '',
          scheduled_end: $('#q-sched-end', ov) ? $('#q-sched-end', ov).value : '',
        };
        if (isAdmin && $('#q-cemail', ov)) { payload.customer_email = $('#q-cemail', ov).value.trim(); }
        try {
          const t = await api.createTicket(payload);
          localStorage.setItem('lastOutlet', outlet);
          toast('Ticket ' + t.ticket_number + ' created', 'success');
          close(); navigate('/tickets/' + t.id);
        } catch (e) {
          if (e.status === 409) toast('Looks like you just sent this — check your list.', 'error');
          else toast(e.message, 'error');
          submit.disabled = false; submit.textContent = 'Submit report';
        }
      });
    },
  });
}

// ==========================================================================
// Shared UI bits
// ==========================================================================
function emptyBox(icon, title, sub) { return `<div class="empty">${svg(ICONS[icon] || ICONS.ticket, 46)}<h3>${esc(title)}</h3><p>${esc(sub)}</p></div>`; }
function errBox(e) { return `<div class="empty"><h3>Something went wrong</h3><p>${esc(e.message || 'Please try again')}</p></div>`; }
function skeletonRows() { return Array(4).fill('<div class="skeleton"></div>').join(''); }
function wireNavLinks() { $$('[data-nav]').forEach((a) => { if (a._wired) return; a._wired = true; a.addEventListener('click', (e) => { e.preventDefault(); navigate(a.getAttribute('href')); }); }); }

// ==========================================================================
// Global wiring + init
// ==========================================================================
async function doLogout() {
  try { await api.logout(); } catch (_) {}
  state.user = null; state.meta.outlets = null;
  navigate('/login');
  toast('Signed out', 'info');
}
function openChangePasswordModal() {
  const { overlay, close } = openModal({
    title: 'Change Password',
    bodyHTML: `
      <form id="form-change-pw">
        <p class="muted mb" style="font-size:.85rem">Update your account password securely.</p>
        <div class="field">
          <label>Current Password <span class="req-star">*</span></label>
          <div class="input-pw" style="position:relative">
            <input type="password" id="pw-old" required placeholder="Enter current password" style="width:100%;padding-right:36px">
            <button type="button" class="pw-toggle" style="position:absolute;right:8px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;opacity:.6">${svg(EYE_ICON, 18)}</button>
          </div>
        </div>
        <div class="field mt">
          <label>New Password <span class="req-star">*</span></label>
          <div class="input-pw" style="position:relative">
            <input type="password" id="pw-new" required placeholder="Enter new password" style="width:100%;padding-right:36px">
            <button type="button" class="pw-toggle" style="position:absolute;right:8px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;opacity:.6">${svg(EYE_ICON, 18)}</button>
          </div>
          <span class="hint">Min 10 characters, including uppercase, lowercase, numbers, and special characters.</span>
        </div>
        <div class="field mt">
          <label>Confirm New Password <span class="req-star">*</span></label>
          <div class="input-pw" style="position:relative">
            <input type="password" id="pw-confirm" required placeholder="Re-enter new password" style="width:100%;padding-right:36px">
            <button type="button" class="pw-toggle" style="position:absolute;right:8px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;opacity:.6">${svg(EYE_ICON, 18)}</button>
          </div>
        </div>
      </form>`,
    footHTML: `<button class="btn-ghost" data-cancel>Cancel</button><button class="btn-primary" id="btn-save-pw">Update Password</button>`,
    size: 'md',
    onMount(ov, close) {
      $('[data-cancel]', ov).addEventListener('click', close);
      $('#btn-save-pw', ov).addEventListener('click', async () => {
        const oldPassword = $('#pw-old', ov).value;
        const newPassword = $('#pw-new', ov).value;
        const confirmPassword = $('#pw-confirm', ov).value;
        if (!oldPassword || !newPassword || !confirmPassword) return toast('All password fields are required', 'error');
        if (newPassword !== confirmPassword) return toast('New password and confirmation do not match', 'error');

        const btn = $('#btn-save-pw', ov);
        btn.disabled = true; btn.textContent = 'Updating…';
        try {
          await api.changePassword({ oldPassword, newPassword, confirmPassword });
          toast('Password changed successfully!', 'success');
          close();
        } catch (e) {
          toast(e.message || 'Failed to change password', 'error');
          btn.disabled = false; btn.textContent = 'Update Password';
        }
      });
    }
  });
}

function initTheme() {
  const saved = localStorage.getItem('theme');
  // Explicit saved choice wins; otherwise follow the OS preference.
  const light = saved ? saved === 'light' : !window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.body.classList.toggle('light', light);
  updateThemeIcons();
}
function updateThemeIcons() {
  const light = document.body.classList.contains('light');
  $('.ico-sun').hidden = !light; $('.ico-moon').hidden = light;
}

document.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  // Global controls
  $('#btn-hamburger').addEventListener('click', openDrawer);
  $('#drawer-close').addEventListener('click', closeDrawer);
  $('#drawer-overlay').addEventListener('click', closeDrawer);
  $('#btn-logout').addEventListener('click', doLogout);
  const btnCp = $('#btn-change-password');
  if (btnCp) btnCp.addEventListener('click', openChangePasswordModal);
  $('#btn-report-quick').addEventListener('click', () => openReportModal());
  $('#btn-theme').addEventListener('click', () => { document.body.classList.toggle('light'); localStorage.setItem('theme', document.body.classList.contains('light') ? 'light' : 'dark'); updateThemeIcons(); });
  // Delegate auth-screen nav links
  document.addEventListener('click', (e) => { const a = e.target.closest('[data-nav]'); if (a && $('#auth-root').contains(a)) { e.preventDefault(); navigate(a.getAttribute('href')); } });
  // Escape closes the mobile drawer (when no modal is open to handle it first)
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#modal-root').hasChildNodes() && $('#app-shell').classList.contains('drawer-open')) closeDrawer(); });
  // Password show/hide toggle (delegated — works for auth screens and modals)
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.pw-toggle'); if (!btn) return;
    e.preventDefault();
    const inp = $('input', btn.parentElement); if (!inp) return;
    const show = inp.type === 'password';
    inp.type = show ? 'text' : 'password';
    btn.innerHTML = svg(show ? EYE_OFF_ICON : EYE_ICON, 18);
    btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    inp.focus();
  });

  // Session check
  try { state.user = await api.me(); } catch (_) { state.user = null; }
  $('#app-loading').classList.add('fade-out');
  setTimeout(() => { $('#app-loading').hidden = true; }, 300);
  if (state.user) boot();
  route();
});
