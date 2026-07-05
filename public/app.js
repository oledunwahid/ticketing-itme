/* ==========================================================================
   IT-ME Ticketing — Frontend SPA (vanilla JS, role-aware, responsive)
   ========================================================================== */
'use strict';

// ---- Domain constants (mirror backend) ----
const STATUSES = ['New', 'Open', 'Assigned', 'On Progress', 'Waiting Sparepart',
  'Waiting Vendor', 'Pending Outlet Response', 'Escalated', 'Resolved', 'Closed', 'Cancelled'];
const URGENCIES = ['Low', 'Medium', 'High', 'Critical'];
const TECH_STATUSES = ['On Progress', 'Waiting Sparepart', 'Waiting Vendor', 'Pending Outlet Response', 'Escalated', 'Resolved'];
const ADMIN_ROLES = ['SuperAdmin', 'AdminIT', 'AdminME'];
const CAN_CREATE = ['Requestor', 'SuperAdmin', 'AdminIT', 'AdminME'];

const NAV = {
  SuperAdmin: ['dashboard', 'tickets', 'queue', 'schedules', 'reports', 'users', 'categories'],
  AdminIT: ['dashboard', 'tickets', 'queue', 'schedules', 'reports', 'categories'],
  AdminME: ['dashboard', 'tickets', 'queue', 'schedules', 'reports', 'categories'],
  TechnicianIT: ['tickets', 'categories'],
  TechnicianME: ['tickets', 'categories'],
  Requestor: ['tickets'],
  Leader: ['dashboard', 'tickets', 'reports'],
};
const NAV_META = {
  dashboard: { label: 'Dashboard', icon: 'grid' },
  tickets: { label: 'Tickets', icon: 'ticket' },
  queue: { label: 'Queue', icon: 'inbox' },
  schedules: { label: 'Schedules', icon: 'calendar' },
  reports: { label: 'Reports', icon: 'chart' },
  users: { label: 'Users', icon: 'users' },
  categories: { label: 'Categories', icon: 'tag' },
};
const ICONS = {
  grid: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
  ticket: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
  inbox: '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  chart: '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/>',
  tag: '<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>',
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
    state.user = null; renderAuth('login');
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
  login: (email, password) => apiJSON('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  register: (b) => apiJSON('/api/auth/register', { method: 'POST', body: JSON.stringify(b) }),
  logout: () => rawFetch('/api/auth/logout', { method: 'POST' }),
  outlets: () => apiJSON('/api/meta/outlets'),
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
  comment: (id, b) => apiJSON('/api/tickets/' + id + '/comments', { method: 'POST', body: JSON.stringify(b) }),
  technicians: (dept) => apiJSON('/api/technicians' + (dept ? '?department=' + dept : '')),
  schedules: (id) => apiJSON('/api/technicians/' + id + '/schedules'),
  addSchedule: (id, b) => apiJSON('/api/technicians/' + id + '/schedules', { method: 'POST', body: JSON.stringify(b) }),
  delSchedule: (id, sid) => apiJSON('/api/technicians/' + id + '/schedules/' + sid, { method: 'DELETE' }),
  addUnavail: (id, b) => apiJSON('/api/technicians/' + id + '/unavailability', { method: 'POST', body: JSON.stringify(b) }),
  dashboard: () => apiJSON('/api/dashboard'),
  report: (qs) => apiJSON('/api/reports/tickets' + (qs ? '?' + qs : '')),
  users: () => apiJSON('/api/users'),
  createUser: (b) => apiJSON('/api/users', { method: 'POST', body: JSON.stringify(b) }),
  patchUser: (id, b) => apiJSON('/api/users/' + id, { method: 'PATCH', body: JSON.stringify(b) }),
  delUser: (id) => apiJSON('/api/users/' + id, { method: 'DELETE' }),
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
            vals[f.name] = f.type === 'checkbox' ? el.checked : el.value.trim();
            if (f.required && !vals[f.name]) { toast(`${f.label} is required`, 'error'); el.focus(); return; }
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
    zone.addEventListener('click', (e) => { if (e.target.closest('.preview-card')) return; input.click(); });
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
function renderAuth(mode) {
  $('#app-shell').hidden = true;
  const root = $('#auth-root'); root.hidden = false;
  if (mode === 'register') return renderRegister(root);
  root.innerHTML = `
    <form class="auth-card" id="login-form">
      <div class="auth-brand"><div class="brand-mark">IM</div><span class="brand-text">IT-ME Ticketing</span></div>
      <div class="auth-title">Sign in</div>
      <div class="auth-sub">Report & track operational issues</div>
      <div class="field"><label>Email</label><input type="email" id="li-email" required autocomplete="username"></div>
      <div class="field"><label>Password</label>${pwInput('li-pw', 'required autocomplete="current-password"')}</div>
      <button class="btn-primary btn-block" id="li-submit">Sign in</button>
      <div class="auth-switch">No account? <a href="/register" data-nav>Register</a></div>
    </form>`;
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#li-submit'); btn.disabled = true; btn.textContent = 'Signing in…';
    try {
      state.user = await api.login($('#li-email').value.trim(), $('#li-pw').value);
      const p = new URLSearchParams(location.search).get('redirect');
      boot(); navigate(p || defaultRoute());
    } catch (err) { toast(err.message || 'Login failed', 'error'); btn.disabled = false; btn.textContent = 'Sign in'; }
  });
}
async function renderRegister(root) {
  let brands = [];
  try { brands = await api.brands(); } catch (_) {}
  root.innerHTML = `
    <form class="auth-card" id="reg-form">
      <div class="auth-brand"><div class="brand-mark">IM</div><span class="brand-text">IT-ME Ticketing</span></div>
      <div class="auth-title">Create account</div>
      <div class="auth-sub">For outlet requestors</div>
      <div class="field"><label>Full name <span class="req-star">*</span></label><input id="rg-name" required></div>
      <div class="field"><label>Email <span class="req-star">*</span></label><input type="email" id="rg-email" required></div>
      <div class="field"><label>Brand (optional)</label><select id="rg-brand"><option value="">—</option>${brands.map((b) => `<option value="${esc(b.code)}">${esc(b.code)}</option>`).join('')}</select></div>
      <div class="field"><label>Password <span class="req-star">*</span></label>${pwInput('rg-pw', 'required autocomplete="new-password"')}</div>
      <div class="field"><label>Confirm password <span class="req-star">*</span></label>${pwInput('rg-pw2', 'required autocomplete="new-password"')}</div>
      <div class="checklist" id="rg-ck"></div>
      <button class="btn-primary btn-block mt" id="rg-submit" disabled>Register</button>
      <div class="auth-switch">Have an account? <a href="/login" data-nav>Sign in</a></div>
    </form>`;
  const reqs = [['len', '10+ characters', (p) => p.length >= 10], ['up', 'Uppercase', (p) => /[A-Z]/.test(p)],
    ['lo', 'Lowercase', (p) => /[a-z]/.test(p)], ['no', 'Number', (p) => /\d/.test(p)],
    ['sp', 'Special (!@#$…)', (p) => /[@$!%*?&]/.test(p)], ['mt', 'Passwords match', (p, c) => p && p === c]];
  const ck = $('#rg-ck'); ck.innerHTML = reqs.map((r) => `<div class="ck" data-r="${r[0]}">✕ ${r[1]}</div>`).join('');
  const val = () => {
    const p = $('#rg-pw').value, c = $('#rg-pw2').value; let all = true;
    reqs.forEach((r) => { const ok = r[2](p, c); const el = $(`[data-r="${r[0]}"]`, ck); el.classList.toggle('met', ok); el.textContent = (ok ? '✓ ' : '✕ ') + r[1]; if (!ok) all = false; });
    $('#rg-submit').disabled = !all;
  };
  $('#rg-pw').addEventListener('input', val); $('#rg-pw2').addEventListener('input', val);
  $('#reg-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#rg-submit'); btn.disabled = true; btn.textContent = 'Registering…';
    try {
      await api.register({ username: $('#rg-name').value.trim(), email: $('#rg-email').value.trim(), brand: $('#rg-brand').value, password: $('#rg-pw').value, passwordConfirm: $('#rg-pw2').value });
      toast('Account created — please sign in', 'success'); navigate('/login');
    } catch (err) { toast(err.message, 'error'); btn.disabled = false; btn.textContent = 'Register'; }
  });
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
  if (!state.user) {
    if (path === '/register') return renderAuth('register');
    return renderAuth('login');
  }
  const parts = path.split('/').filter(Boolean);
  let name = parts[0] || defaultRoute().slice(1);
  const id = parts[1] || null;

  // RBAC route guard (mirror backend; backend is source of truth)
  const allowed = NAV[state.user.role] || [];
  if (name === 'tickets' && id) { state.route = { name: 'ticket', id }; setActiveNav('tickets'); animateViewIn(); return renderTicketDetail(id); }
  if (!allowed.includes(name) && !['ticket'].includes(name)) {
    if (name === 'categories') {
      state.route = { name: 'categories', id: null };
      setActiveNav('categories');
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
    categories: renderCategories
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
    $('#d-stats').innerHTML = `
      ${statCard(d.totals.total, 'Total tickets', 'primary')}
      ${statCard(d.totals.open, 'Open', 'warn')}
      ${statCard(d.totals.unassigned, 'Unassigned', 'danger')}
      ${statCard(d.totals.waiting, 'Waiting parts/vendor')}
      ${statCard(d.avg_resolution_hours != null ? d.avg_resolution_hours + 'h' : '—', 'Avg resolution', 'ok')}`;
    animateCounters($('#d-stats'));
    const distMax = Math.max(1, ...d.byStatus.map((s) => s.c));
    $('#d-rest').innerHTML = `
      <div class="grid-2">
        <div class="panel"><div class="panel-head"><h3>By status</h3></div><div class="card" style="border:none">
          ${d.byStatus.length ? d.byStatus.map((s) => `<div class="dist-row"><span>${badge(s.status)}</span><div class="row" style="flex:1;margin:0 12px"><div class="dist-bar ${stCls(s.status)}" style="width:${Math.round(s.c / distMax * 100)}%;background:currentColor;opacity:.5"></div></div><strong>${s.c}</strong></div>`).join('') : '<p class="muted">No data</p>'}
        </div></div>
        <div class="panel"><div class="panel-head"><h3>By department</h3></div><div class="card" style="border:none">
          ${d.byDept.filter((x) => x.department).map((s) => `<div class="dist-row"><span>${deptTag(s.department)}</span><strong>${s.c}</strong></div>`).join('') || '<p class="muted">No data</p>'}
          <div class="divider"></div><h3 style="font-size:.85rem;margin-bottom:6px">Top outlets</h3>
          ${d.byOutlet.filter((x) => x.outlet_code).slice(0, 6).map((s) => `<div class="dist-row"><span>${esc(s.outlet_code)}</span><strong>${s.c}</strong></div>`).join('') || '<p class="muted">No data</p>'}
        </div></div>
      </div>
      <div class="grid-2 mt">
        <div class="panel"><div class="panel-head"><h3>Recurring categories</h3></div><div class="card" style="border:none">
          ${d.topCategories.length ? d.topCategories.map((c) => `<div class="dist-row"><span>${deptTag(c.department)} ${esc(c.category)}</span><strong>${c.c}</strong></div>`).join('') : '<p class="muted">No data</p>'}
        </div></div>
        ${d.workload && d.workload.length ? `<div class="panel"><div class="panel-head"><h3>Technician workload</h3></div><div class="card" style="border:none">
          ${d.workload.map((w) => `<div class="dist-row"><span>${esc(w.technician)} ${deptTag(w.department)}</span><strong>${w.open} open</strong></div>`).join('')}
        </div></div>` : ''}
      </div>`;
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
const listFilters = { status: '', urgency: '', department: '', search: '' };
async function renderTickets() {
  const showDept = ['SuperAdmin', 'Leader'].includes(state.user.role);
  view().innerHTML = `
    <div class="page-head"><h2>${navLabel('tickets')}</h2><p>${ticketsSubtitle()}</p></div>
    <div class="toolbar">
      <div class="search"><input id="f-search" placeholder="Search subject, #, requester…" value="${esc(listFilters.search)}"></div>
      <select id="f-status"><option value="">All statuses</option>${STATUSES.map((s) => `<option ${listFilters.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
      <select id="f-urg"><option value="">All urgency</option>${URGENCIES.map((s) => `<option ${listFilters.urgency === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
      ${showDept ? `<select id="f-dept"><option value="">All depts</option><option ${listFilters.department === 'IT' ? 'selected' : ''}>IT</option><option ${listFilters.department === 'ME' ? 'selected' : ''}>ME</option></select>` : ''}
    </div>
    <div id="ticket-list" class="ticket-list">${skeletonRows()}</div>`;
  $('#f-search').addEventListener('input', debounce((e) => { listFilters.search = e.target.value.trim(); loadTicketList(); }, 350));
  $('#f-status').addEventListener('change', (e) => { listFilters.status = e.target.value; loadTicketList(); });
  $('#f-urg').addEventListener('change', (e) => { listFilters.urgency = e.target.value; loadTicketList(); });
  if (showDept) $('#f-dept').addEventListener('change', (e) => { listFilters.department = e.target.value; loadTicketList(); });
  loadTicketList();
}
function ticketsSubtitle() {
  const r = state.user.role;
  if (r === 'Requestor') return 'Issues you have reported';
  if (r.startsWith('Technician')) return 'Jobs assigned to you';
  if (r === 'Leader') return 'View-only across your scope';
  return 'Manage and respond to tickets';
}
async function loadTicketList() {
  const qs = new URLSearchParams();
  Object.entries(listFilters).forEach(([k, v]) => { if (v) qs.append(k, v); });
  try {
    const rows = await api.tickets(qs.toString());
    const box = $('#ticket-list'); if (!box) return;
    if (!rows.length) { box.innerHTML = emptyBox('ticket', 'No tickets', CAN_CREATE.includes(state.user.role) ? 'Tap “Report Issue” to create one.' : 'Nothing here yet.'); return; }
    box.innerHTML = rows.map(ticketRow).join('');
    $$('.ticket-row', box).forEach((el) => el.addEventListener('click', () => navigate('/tickets/' + el.dataset.id)));
  } catch (e) { const box = $('#ticket-list'); if (box) box.innerHTML = errBox(e); }
}
function ticketRow(t) {
  return `<div class="ticket-row" data-id="${t.id}">
    <div>${deptTag(t.department)}</div>
    <div style="min-width:0">
      <div class="tnum">${esc(t.ticket_number || '#' + t.id)}</div>
      <div class="ttitle">${esc(t.title)}</div>
      <div class="tmeta"><span>${esc(t.outlet_code || '—')}${t.brand_code ? ' · ' + esc(t.brand_code) : ''}</span><span>${esc(t.category || '')}</span><span>${esc(t.assignee_name && t.assignee_name !== 'Unassigned' ? '👤 ' + t.assignee_name : 'Unassigned')}</span><span class="aging ${agingClass(t)}">${timeAgo(t.created_at)}</span></div>
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

  // Merge timeline
  const events = [
    ...comments.map((c) => ({ t: c.created_at, kind: c.is_system ? 'sys' : 'msg', author: c.author_name, role: c.author_role, text: c.message })),
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
      <div class="detail-badges">${urgBadge(t.urgency)}${badge(t.status)}</div>
    </div>
    <div class="detail-grid">
      <div>
        <div class="card mb">
          <dl class="info-list">
            <dt>Outlet</dt><dd>${esc(t.outlet_code || '—')} ${t.brand_code ? '· ' + esc(t.brand_code) : ''}</dd>
            <dt>Requester</dt><dd>${esc(t.customer_name || '—')}</dd>
            <dt>Contact</dt><dd>${esc(t.contact_number || '—')}</dd>
            <dt>Assignee</dt><dd>${esc(t.assignee_name || 'Unassigned')}</dd>
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
  if (e.kind === 'sys') return `<div class="tl-item sys"><div class="tl-head"><span class="tl-author">${esc(e.author || 'System')}</span><span class="tl-time">${fmtDate(e.t)}</span></div><div class="tl-msg">${esc(e.text)}</div></div>`;
  return `<div class="tl-item"><div class="tl-head"><span class="tl-author">${esc(e.author)}</span><span class="tl-role">${esc(e.role)}</span><span class="tl-time">${fmtDate(e.t)}</span></div><div class="tl-msg">${esc(e.text)}</div></div>`;
}
function attCard(a) {
  const isImg = (a.mime_type || '').startsWith('image/');
  const phaseTag = a.phase && a.phase !== 'general' ? `<span class="phase-tag phase-${esc(a.phase)}">${esc(a.phase)}</span>` : '';
  if (isImg) return `<a class="att-card" href="${esc(a.file_url)}" target="_blank" style="flex-direction:column;align-items:stretch;width:150px">${phaseTag}<img class="att-thumb" src="${esc(a.file_url)}" alt="${esc(a.file_name)}" loading="lazy"><span class="an">${esc(a.file_name)}</span></a>`;
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
function actionPaneHTML(t, isDeptAdmin, isAssignedTech) {
  if (!isDeptAdmin && !isAssignedTech) return `<div class="card"><h3 style="font-size:.95rem;margin-bottom:6px">Status</h3>${badge(t.status)}<p class="muted mt" style="font-size:.8rem">You’ll be notified of updates here.</p></div>`;
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

// Assignment modal with recommendation
async function openAssignModal(t, after) {
  const { overlay, close } = openModal({
    title: 'Assign technician — ' + (t.ticket_number || '#' + t.id),
    bodyHTML: `<div id="rec-box"><div class="loading-inline">Finding available technicians…</div></div>
      <div class="divider"></div>
      <div class="field"><label>Manual override</label><select id="manual-tech"><option value="">Choose technician…</option></select></div>
      <label class="row gap-sm" style="cursor:pointer;font-size:.82rem"><input type="checkbox" id="ov-check" style="width:auto"> Force even if wrong department / off-duty</label>`,
    footHTML: `<button class="btn-ghost" data-cancel>Cancel</button><button class="btn-primary" data-manual>Assign selected</button>`,
    size: 'lg',
    async onMount(ov) {
      $('[data-cancel]', ov).addEventListener('click', close);
      try {
        const [recs, techs] = await Promise.all([api.recommend(t.id), api.technicians(t.department)]);
        const rb = $('#rec-box', ov);
        rb.innerHTML = recs.length ? recs.map((r, i) => `
          <div class="rec-item ${i === 0 && r.available ? 'best' : ''}">
            <div class="rec-info"><div class="rec-name">${esc(r.username)} ${i === 0 && r.available ? '⭐' : ''}</div><div class="rec-reasons">${esc(r.reasons.join(' · '))}</div></div>
            <span class="rec-avail ${r.available ? 'yes' : 'no'}">${r.available ? 'available' : 'busy'}</span>
            <button class="btn-primary" data-rec="${r.id}" style="padding:7px 12px">Assign</button>
          </div>`).join('') : '<p class="muted">No technicians configured for this department.</p>';
        $('#manual-tech', ov).innerHTML = '<option value="">Choose technician…</option>' + techs.map((x) => `<option value="${x.id}">${esc(x.username)} (${x.workload} open)</option>`).join('');
        $$('[data-rec]', ov).forEach((b) => b.addEventListener('click', () => doAssign(t, b.dataset.rec, false, close, after)));
      } catch (e) { $('#rec-box', ov).innerHTML = errBox(e); }
      $('[data-manual]', ov).addEventListener('click', () => {
        const id = $('#manual-tech', ov).value; if (!id) { toast('Pick a technician', 'error'); return; }
        doAssign(t, id, $('#ov-check', ov).checked, close, after);
      });
    },
  });
}
async function doAssign(t, techId, override, close, after) {
  try {
    await api.assign(t.id, { technician_id: Number(techId), override });
    toast('Technician assigned', 'success'); close(); if (after) after();
  } catch (e) {
    if (/override/i.test(e.message)) toast(e.message + ' Tick the override box to force.', 'error');
    else toast(e.message, 'error');
  }
}

// ==========================================================================
// View: Schedules
// ==========================================================================
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
async function renderSchedules() {
  const dept = state.user.role === 'AdminIT' ? 'IT' : state.user.role === 'AdminME' ? 'ME' : '';
  view().innerHTML = `<div class="page-head"><h2>Technician schedules</h2><p>Availability drives assignment recommendations</p></div>
    <div class="toolbar">${!dept ? `<select id="sch-dept"><option value="">All</option><option>IT</option><option>ME</option></select>` : ''}</div>
    <div id="tech-list">${skeletonRows()}</div>`;
  const load = async (d) => {
    try {
      const techs = await api.technicians(d || undefined);
      const box = $('#tech-list');
      if (!techs.length) { box.innerHTML = emptyBox('users', 'No technicians', 'Add technician users first.'); return; }
      box.innerHTML = techs.map((t) => `<div class="panel mb"><div class="panel-head"><h3>${esc(t.username)} ${deptTag(t.department || (t.role === 'TechnicianIT' ? 'IT' : 'ME'))}</h3><span class="muted">${t.workload} open</span></div><div class="card" style="border:none" id="sch-${t.id}"><div class="loading-inline">Loading…</div></div></div>`).join('');
      for (const t of techs) loadTechSchedule(t);
    } catch (e) { $('#tech-list').innerHTML = errBox(e); }
  };
  if (!dept) $('#sch-dept').addEventListener('change', (e) => load(e.target.value));
  load(dept);
}
async function loadTechSchedule(t) {
  const box = $('#sch-' + t.id); if (!box) return;
  try {
    const { schedules, unavailability } = await api.schedules(t.id);
    box.innerHTML = `
      <div class="chips mb">${schedules.length ? schedules.map((s) => `<span class="chip">${DOW[s.day_of_week]} ${s.start_time}–${s.end_time} <button data-del="${s.id}" class="pc-retry" style="color:var(--danger)">✕</button></span>`).join('') : '<span class="muted">No working hours set</span>'}</div>
      ${unavailability.length ? `<div class="mb"><strong style="font-size:.8rem">Unavailable:</strong> ${unavailability.map((u) => `<span class="chip">${fmtDate(u.start_datetime)} → ${fmtDate(u.end_datetime)}${u.reason ? ' · ' + esc(u.reason) : ''}</span>`).join(' ')}</div>` : ''}
      <div class="row wrap gap-sm"><button class="btn-outline" data-add="${t.id}" style="padding:7px 12px">+ Working hours</button><button class="btn-outline" data-off="${t.id}" style="padding:7px 12px">+ Day off / block</button></div>`;
    $$('[data-del]', box).forEach((b) => b.addEventListener('click', async () => {
      try { await api.delSchedule(t.id, b.dataset.del); toast('Working hours removed', 'success'); loadTechSchedule(t); }
      catch (e) { toast(e.message, 'error'); }
    }));
    $('[data-add]', box).addEventListener('click', async () => {
      const v = await formModal('Add working hours', [
        { name: 'day_of_week', label: 'Day', type: 'select', value: '1', options: DOW.map((d, i) => ({ value: String(i), label: d })) },
        { name: 'start_time', label: 'Start (HH:MM)', type: 'time', value: '09:00', required: true },
        { name: 'end_time', label: 'End (HH:MM)', type: 'time', value: '18:00', required: true },
      ], 'Add');
      if (!v) return;
      try { await api.addSchedule(t.id, { day_of_week: Number(v.day_of_week), start_time: v.start_time, end_time: v.end_time }); toast('Working hours added', 'success'); loadTechSchedule(t); }
      catch (e) { toast(e.message, 'error'); }
    });
    $('[data-off]', box).addEventListener('click', async () => {
      const v = await formModal('Add unavailability', [
        { name: 'start_datetime', label: 'From', type: 'datetime-local', required: true },
        { name: 'end_datetime', label: 'To', type: 'datetime-local', required: true },
        { name: 'reason', label: 'Reason', type: 'text' },
      ], 'Add');
      if (!v) return;
      try { await api.addUnavail(t.id, v); toast('Unavailability saved', 'success'); loadTechSchedule(t); } catch (e) { toast(e.message, 'error'); }
    });
  } catch (e) { box.innerHTML = errBox(e); }
}

// ==========================================================================
// View: Reports
// ==========================================================================
async function renderReports() {
  const showDept = ['SuperAdmin', 'Leader'].includes(state.user.role);
  let brands = [];
  try { brands = await api.brands(); } catch (_) {}
  view().innerHTML = `<div class="page-head"><h2>Reports</h2><p>Server-side, permission-scoped</p></div>
    <div class="card mb">
      <div class="field-row">
        ${showDept ? `<div class="field"><label>Department</label><select id="r-dept"><option value="">All</option><option>IT</option><option>ME</option></select></div>` : ''}
        <div class="field"><label>Brand</label><select id="r-brand"><option value="">All</option>${brands.map((b) => `<option>${esc(b.code)}</option>`).join('')}</select></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Status</label><select id="r-status"><option value="">All</option>${STATUSES.map((s) => `<option>${s}</option>`).join('')}</select></div>
        <div class="field"><label>Urgency</label><select id="r-urg"><option value="">All</option>${URGENCIES.map((s) => `<option>${s}</option>`).join('')}</select></div>
      </div>
      <div class="field-row">
        <div class="field"><label>From</label><input type="date" id="r-from"></div>
        <div class="field"><label>To</label><input type="date" id="r-to"></div>
      </div>
      <div class="row wrap gap-sm">
        <button class="btn-primary" id="r-run">Generate</button>
        <button class="btn-outline" id="r-csv">Export CSV</button>
        <button class="btn-outline" id="r-print">Print</button>
      </div>
    </div>
    <div id="r-result"></div>`;
  const params = () => {
    const q = new URLSearchParams();
    if (showDept && $('#r-dept').value) q.append('department', $('#r-dept').value);
    if ($('#r-brand').value) q.append('brand', $('#r-brand').value);
    if ($('#r-status').value) q.append('status', $('#r-status').value);
    if ($('#r-urg').value) q.append('urgency', $('#r-urg').value);
    if ($('#r-from').value) q.append('start_date', $('#r-from').value);
    if ($('#r-to').value) q.append('end_date', $('#r-to').value);
    return q;
  };
  $('#r-run').addEventListener('click', async () => {
    const q = params();
    if ($('#r-from').value && $('#r-to').value && $('#r-from').value > $('#r-to').value) { toast('Start date is after end date', 'error'); return; }
    $('#r-result').innerHTML = `<div class="loading-inline">Running report…</div>`;
    try {
      const rows = await api.report(q.toString());
      $('#r-result').innerHTML = rows.length ? reportTable(rows) : emptyBox('chart', 'No matching tickets', 'Adjust filters and try again.');
      toast(rows.length ? `Report ready — ${rows.length} ticket(s)` : 'No matching tickets', rows.length ? 'success' : 'info');
    } catch (e) { $('#r-result').innerHTML = errBox(e); toast(e.message, 'error'); }
  });
  $('#r-csv').addEventListener('click', () => { window.open('/api/reports/export?' + params().toString(), '_blank'); toast('Preparing CSV export…', 'info'); });
  $('#r-print').addEventListener('click', () => window.print());
}
function reportTable(rows) {
  return `<div class="panel"><div class="panel-head"><h3>${rows.length} ticket(s)</h3></div><div class="table-wrap"><table class="data">
    <thead><tr><th>Ticket</th><th>Dept</th><th>Category</th><th>Outlet</th><th>Status</th><th>Urgency</th><th>Assignee</th><th>Created</th></tr></thead>
    <tbody>${rows.map((t) => `<tr><td class="nowrap">${esc(t.ticket_number)}</td><td>${deptTag(t.department)}</td><td>${esc(t.category || '')}</td><td>${esc(t.outlet_display || t.outlet_code || '')}</td><td>${badge(t.status)}</td><td>${urgBadge(t.urgency)}</td><td>${esc(t.assignee_name || '')}</td><td class="nowrap">${fmtDate(t.created_at)}</td></tr>`).join('')}</tbody>
  </table></div></div>`;
}

// ==========================================================================
// View: Users (SuperAdmin)
// ==========================================================================
async function renderUsers() {
  view().innerHTML = `<div class="page-head"><h2>Users</h2><p>Manage staff, roles & access</p></div>
    <div class="toolbar"><div class="search"><input id="u-search" placeholder="Search name / email…"></div><button class="btn-primary" id="u-add">+ Add user</button></div>
    <div class="panel"><div class="table-wrap"><table class="data"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Dept</th><th>Access</th><th>Status</th><th></th></tr></thead><tbody id="u-body"><tr><td colspan="7" class="loading-inline">Loading…</td></tr></tbody></table></div></div>`;
  let all = [];
  const draw = (term = '') => {
    const rows = all.filter((u) => !term || u.username.toLowerCase().includes(term) || u.email.toLowerCase().includes(term));
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
  const access = u.all_brands ? 'All brands' : (u.brand || '—');
  return `<tr>
    <td><strong>${esc(u.username)}</strong> ${self ? '<span class="muted">(you)</span>' : ''}</td>
    <td>${esc(u.email)}</td><td>${esc(u.role)}</td><td>${esc(u.department || '—')}</td>
    <td>${esc(access)}</td>
    <td>${u.is_active ? '<span class="badge st-Resolved">Active</span>' : '<span class="badge st-Cancelled">Inactive</span>'}</td>
    <td class="nowrap"><button class="btn-ghost" data-edit="${u.id}" style="padding:6px 8px">Edit</button>${self ? '' : `<button class="btn-ghost" data-del="${u.id}" style="padding:6px 8px;color:var(--danger)">Del</button>`}</td>
  </tr>`;
}
const ALL_ROLES = ['Requestor', 'TechnicianIT', 'TechnicianME', 'AdminIT', 'AdminME', 'Leader', 'SuperAdmin'];
async function openUserModal(u, after) {
  const isEdit = !!u;
  const v = await formModal(isEdit ? 'Edit user' : 'Add user', [
    { name: 'username', label: 'Full name', required: !isEdit, value: u ? u.username : '' },
    { name: 'email', label: 'Email', type: 'email', required: !isEdit, value: u ? u.email : '' },
    { name: 'role', label: 'Role', type: 'select', value: u ? u.role : 'Requestor', options: ALL_ROLES.map((r) => ({ value: r, label: r })) },
    { name: 'brand', label: 'Brand (blank = none)', value: u ? (u.brand || '') : '' },
    { name: 'all_brands', label: '', type: 'checkbox', checkboxLabel: 'All-brand access', value: u ? !!u.all_brands : false },
    { name: 'can_close_override', label: '', type: 'checkbox', checkboxLabel: 'Technician may close tickets', value: u ? !!u.can_close_override : false },
    { name: 'is_active', label: '', type: 'checkbox', checkboxLabel: 'Active', value: u ? !!u.is_active : true },
    { name: 'password', label: isEdit ? 'New password (blank = keep)' : 'Password', type: 'password', required: !isEdit, hint: 'Min 10 chars, upper/lower/number/special' },
  ], isEdit ? 'Save' : 'Create');
  if (!v) return;
  const payload = { username: v.username, email: v.email, role: v.role, brand: v.brand || null, all_brands: v.all_brands, can_close_override: v.can_close_override, is_active: v.is_active };
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
// Quick / detailed report modal
// ==========================================================================
let quickUploader = null;
async function openReportModal() {
  const outlets = await loadOutlets().catch(() => []);
  const brandsGroups = {};
  outlets.forEach((o) => { (brandsGroups[o.brand_code] = brandsGroups[o.brand_code] || []).push(o); });
  const lastOutlet = localStorage.getItem('lastOutlet') || '';
  const optgroups = Object.entries(brandsGroups).map(([b, list]) => `<optgroup label="${esc(b)}">${list.map((o) => `<option value="${esc(o.code)}" ${o.code === lastOutlet ? 'selected' : ''}>${esc(o.code)}</option>`).join('')}</optgroup>`).join('');
  const isAdmin = ADMIN_ROLES.includes(state.user.role);
  const body = `
    <div class="field"><label>Outlet <span class="req-star">*</span></label><select id="q-outlet"><option value="">Select outlet…</option>${optgroups}</select></div>
    <div class="field"><label>Department <span class="req-star">*</span></label>
      <div class="segmented"><button type="button" class="seg-btn big" data-dept="IT">🖥️ IT</button><button type="button" class="seg-btn big" data-dept="ME">🔧 Mechanical</button></div></div>
    <div class="field"><label>Category <span class="req-star">*</span></label><select id="q-cat" disabled><option>Select department first</option></select></div>
    <div class="field"><label>What’s the issue? <span class="req-star">*</span></label><textarea id="q-desc" placeholder="e.g. POS terminal 2 not printing receipts"></textarea></div>
    <div class="field"><label>Urgency</label><div class="segmented" id="q-urg">${URGENCIES.map((u) => `<button type="button" class="seg-btn ${u === 'Medium' ? 'active' : ''}" data-urg="${u}">${u}</button>`).join('')}</div></div>
    <div class="field"><label>Contact / WhatsApp</label><input id="q-contact" placeholder="08xx…" inputmode="tel"></div>
    ${isAdmin ? `<div class="field"><label>Report on behalf of (optional)</label><div class="field-row"><input id="q-cname" placeholder="Name"><input id="q-cemail" placeholder="Email" type="email"></div></div>` : ''}
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
    onMount(ov) {
      quickUploader = new Uploader($('#q-up', ov), $('#q-up-list', ov));
      let dept = '';
      $$('[data-dept]', ov).forEach((b) => b.addEventListener('click', async () => {
        dept = b.dataset.dept;
        $$('[data-dept]', ov).forEach((x) => x.classList.toggle('active', x === b));
        const sel = $('#q-cat', ov); sel.disabled = true; sel.innerHTML = '<option>Loading…</option>';
        try { const cats = await api.categories(dept); sel.innerHTML = '<option value="">Select category…</option>' + cats.map((c) => `<option>${esc(c.name)}</option>`).join(''); sel.disabled = false; }
        catch (e) { sel.innerHTML = '<option>Failed to load</option>'; }
      }));
      let urg = 'Medium';
      $$('[data-urg]', ov).forEach((b) => b.addEventListener('click', () => { urg = b.dataset.urg; $$('[data-urg]', ov).forEach((x) => x.classList.toggle('active', x === b)); }));
      $('#q-more', ov).addEventListener('click', () => { const e = $('#q-extra', ov); e.hidden = !e.hidden; $('#q-more', ov).textContent = (e.hidden ? '▾ Add more details (optional)' : '▴ Hide extra details'); });
      $('[data-cancel]', ov).addEventListener('click', close);
      const submit = $('#q-submit', ov);
      submit.addEventListener('click', async () => {
        const outlet = $('#q-outlet', ov).value, cat = $('#q-cat', ov).value, desc = $('#q-desc', ov).value.trim();
        if (!outlet) return toast('Select an outlet', 'error');
        if (!dept) return toast('Choose IT or Mechanical', 'error');
        if (!cat) return toast('Select a category', 'error');
        if (!desc) return toast('Describe the issue', 'error');
        if (quickUploader.uploading()) return toast('Wait for uploads to finish', 'error');
        submit.disabled = true; submit.textContent = 'Submitting…';
        const payload = {
          department: dept, outlet_code: outlet, category: cat, description: desc, urgency: urg,
          contact_number: $('#q-contact', ov).value.trim(), report_mode: $('#q-extra', ov).hidden ? 'quick' : 'detailed',
          attachmentIds: quickUploader.ids(),
          title: ($('#q-title', ov) && $('#q-title', ov).value.trim()) || '',
          location_detail: $('#q-loc', ov) ? $('#q-loc', ov).value.trim() : '',
          device_equipment: $('#q-dev', ov) ? $('#q-dev', ov).value.trim() : '',
          business_impact: $('#q-impact', ov) ? $('#q-impact', ov).value.trim() : '',
          occurrence_at: $('#q-occ', ov) ? $('#q-occ', ov).value : '',
          preferred_visit_time: $('#q-visit', ov) ? $('#q-visit', ov).value.trim() : '',
        };
        if (isAdmin) { payload.customer_name = $('#q-cname', ov).value.trim(); payload.customer_email = $('#q-cemail', ov).value.trim(); }
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
