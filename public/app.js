/* ==========================================================================
   IT-ME Ticketing — Frontend SPA (vanilla JS, role-aware, responsive)
   ========================================================================== */
'use strict';

// ---- Domain constants (mirror backend) ----
// Status model (mirrors src/config/constants.js). Two layers over one column:
//   CORE      — the simplified daily flow (New → Open → On Progress → Closed)
//   EXTENDED  — operational states kept for admin handling, scheduled event
//               work (On Scheduled), sparepart/vendor waits, escalation, SLA
//               reporting and historical tickets. Never removed.
const CORE_STATUSES = ['New', 'Open', 'On Progress', 'Closed'];
const EXTENDED_STATUSES = ['Assigned', 'On Scheduled', 'Waiting Sparepart', 'Waiting Vendor',
  'Pending Outlet Response', 'Escalated', 'Resolved', 'Cancelled'];
// Full list in workflow order — used by filters, reports and exports.
const STATUSES = ['New', 'Open', 'Assigned', 'On Scheduled', 'On Progress', 'Waiting Sparepart',
  'Waiting Vendor', 'Pending Outlet Response', 'Escalated', 'Resolved', 'Closed', 'Cancelled'];
// Read-side rollup for dashboard cards only — it never rewrites a ticket status.
const STATUS_GROUP_OF = {
  'New': 'New',
  'Open': 'Open', 'Assigned': 'Open', 'On Scheduled': 'Open', 'Waiting Sparepart': 'Open',
  'Waiting Vendor': 'Open', 'Pending Outlet Response': 'Open', 'Escalated': 'Open',
  'On Progress': 'On Progress',
  'Resolved': 'Closed', 'Closed': 'Closed',
  'Cancelled': 'Cancelled',
};
const statusGroup = (s) => STATUS_GROUP_OF[s] || 'Open';
// Allowed next statuses (mirrors src/utils/statusTransition.js). Used only to
// keep the dropdown honest — the server remains the enforcer. Unknown/legacy
// current statuses stay permissive so old tickets can always move forward.
const ALLOWED_TRANSITIONS = {
  'New': ['Open', 'Assigned', 'On Scheduled', 'On Progress', 'Escalated', 'Cancelled'],
  'Open': ['Assigned', 'On Scheduled', 'On Progress', 'Waiting Sparepart', 'Waiting Vendor', 'Pending Outlet Response', 'Escalated', 'Cancelled'],
  'Assigned': ['Open', 'On Scheduled', 'On Progress', 'Waiting Sparepart', 'Waiting Vendor', 'Pending Outlet Response', 'Escalated', 'Cancelled'],
  'On Scheduled': ['Open', 'Assigned', 'On Progress', 'Waiting Sparepart', 'Waiting Vendor', 'Pending Outlet Response', 'Escalated', 'Cancelled'],
  'On Progress': ['Open', 'Assigned', 'On Scheduled', 'Waiting Sparepart', 'Waiting Vendor', 'Pending Outlet Response', 'Escalated', 'Resolved', 'Closed', 'Cancelled'],
  'Waiting Sparepart': ['On Progress', 'On Scheduled', 'Escalated', 'Resolved', 'Cancelled'],
  'Waiting Vendor': ['On Progress', 'On Scheduled', 'Escalated', 'Resolved', 'Cancelled'],
  'Pending Outlet Response': ['On Progress', 'On Scheduled', 'Escalated', 'Resolved', 'Cancelled'],
  'Escalated': ['On Progress', 'On Scheduled', 'Waiting Sparepart', 'Waiting Vendor', 'Pending Outlet Response', 'Resolved', 'Cancelled'],
  'Resolved': ['Closed', 'On Progress', 'Escalated', 'Cancelled'],
  'Closed': ['Open', 'On Progress'],
  'Cancelled': ['Open', 'New'],
};
function canTransition(current, next) {
  if (current === next) return true;
  const allowed = ALLOWED_TRANSITIONS[current];
  return allowed ? allowed.includes(next) : true;
}
const URGENCIES = ['Low', 'Medium', 'High', 'Critical'];
const REGIONS = ['Jakarta', 'Surabaya'];
// Statuses an assigned technician may set (mirrors TECHNICIAN_STATUSES in
// src/config/constants.js). Technicians own the operational middle of the flow
// because they see the field condition first; "New" is system-set and
// "Cancelled" — like reopening — stays admin-only and needs a reason.
const TECH_STATUSES = ['Open', 'On Progress', 'Closed', 'On Scheduled', 'Waiting Sparepart',
  'Waiting Vendor', 'Pending Outlet Response', 'Escalated', 'Resolved'];
// Work is parked waiting on someone else — a short note is expected.
const WAITING_STATUSES = ['Waiting Sparepart', 'Waiting Vendor', 'Pending Outlet Response'];
const TERMINAL_STATUSES = ['Closed', 'Cancelled'];
const ADMIN_ROLES = ['SuperAdmin', 'AdminIT', 'AdminME'];
const CAN_CREATE = ['Requestor', 'SuperAdmin', 'AdminIT', 'AdminME'];

const NAV = {
  SuperAdmin: ['dashboard', 'tickets', 'schedules', 'reports', 'users', 'categories', 'locations', 'importexport'],
  AdminIT: ['dashboard', 'tickets', 'schedules', 'reports', 'users', 'categories', 'locations', 'importexport'],
  AdminME: ['dashboard', 'tickets', 'schedules', 'reports', 'users', 'categories', 'locations', 'importexport'],
  TechnicianIT: ['tickets', 'dashboard', 'categories'],
  TechnicianME: ['tickets', 'dashboard', 'categories'],
  Requestor: ['tickets', 'dashboard'],
  Leader: ['dashboard', 'tickets', 'reports'],
};
// Mobile bottom bar shows the first entries of this order that the role has;
// everything else stays one tap away in the drawer ("More").
const BOTTOM_NAV_ORDER = ['dashboard', 'tickets', 'schedules', 'reports', 'users'];
const DEPT_OF_ROLE = { AdminIT: 'IT', TechnicianIT: 'IT', AdminME: 'ME', TechnicianME: 'ME' };
// ME (Mechanical) is hidden while the app rolls out to IT first.
// Set to true to bring every ME option back into the UI.
const ME_ENABLED = false;
const NAV_META = {
  dashboard: { label: 'Dashboard', icon: 'grid' },
  tickets: { label: 'Tickets', icon: 'ticket' },
  schedules: { label: 'Schedules', icon: 'calendar' },
  reports: { label: 'Reporting & Performance', icon: 'chart' },
  users: { label: 'Users', icon: 'users' },
  categories: { label: 'Categories', icon: 'tag' },
  locations: { label: 'Locations', icon: 'mapPin' },
  importexport: { label: 'Import / Export', icon: 'swap' },
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
  swap: '<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
  // Ticket-detail status & team icons (Lucide paths, drawn by svg() with the
  // same 24×24 / stroke settings as the nav icons — no extra dependency).
  activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  checkCircle: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
  checkCircle2: '<circle cx="12" cy="12" r="10"/><polyline points="16 10 11 15 8 12"/>',
  star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  userPlus: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/>',
  alertTriangle: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  package: '<path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="m3.3 7 8.7 5 8.7-5"/><line x1="12" y1="22" x2="12" y2="12"/>',
  truck: '<path d="M10 17h4V5H2v12h3"/><path d="M20 17h2v-3.34a4 4 0 0 0-1.17-2.83L19 9h-5v8h3"/><circle cx="7.5" cy="17.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>',
  calendarClock: '<path d="M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h6"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><circle cx="17.5" cy="17.5" r="4.5"/><path d="M17.5 15.8v1.9l1.4.9"/>',
  messageCircle: '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  slash: '<circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>',
  // Table row actions (Lucide paths) — see iconBtn()/actionCell() below.
  pencil: '<path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/><path d="m15 5 4 4"/>',
  trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
  eye: '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
  moreHorizontal: '<circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/><circle cx="5" cy="12" r="1.5"/>',
  printer: '<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.64-6.36"/><polyline points="21 3 21 9 15 9"/>',
  search: '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 9.8-9.8"/><path d="m16 7 3 3"/><path d="m19 4 2 2"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>',
  wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  trendingUp: '<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>',
  zap: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
  timer: '<line x1="10" y1="2" x2="14" y2="2"/><line x1="12" y1="14" x2="15" y2="11"/><circle cx="12" cy="14" r="8"/>',
  userX: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="17" y1="8" x2="22" y2="13"/><line x1="22" y1="8" x2="17" y2="13"/>',
  unlock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>',
  phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.9.33 1.78.62 2.63a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.85.29 1.73.5 2.63.62A2 2 0 0 1 22 16.92z"/>',
  filter: '<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>',
  menu: '<line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>',
};

/* Icon per status — one glance should say what state the ticket is in.
   Falls back to the generic activity icon for anything unmapped. */
const STATUS_ICON = {
  'New': 'inbox',
  'Open': 'inbox',
  'Assigned': 'users',
  'On Scheduled': 'calendarClock',
  'On Progress': 'activity',
  'Waiting Sparepart': 'package',
  'Waiting Vendor': 'truck',
  'Pending Outlet Response': 'messageCircle',
  'Escalated': 'alertTriangle',
  'Resolved': 'checkCircle',
  'Closed': 'checkCircle2',
  'Cancelled': 'slash',
};
const statusIcon = (s, size = 15) => svg(ICONS[STATUS_ICON[s]] || ICONS.activity, size);

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
function svg(paths, size = 20) { return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths}</svg>`; }
const parseTs = (s) => {
  if (!s) return null;
  const str = String(s);
  const d = new Date(/[TZ]/.test(str) ? str : str.replace(' ', 'T') + 'Z');
  return isNaN(d.getTime()) ? null : d;
};
function fmtFull(s) {
  const d = parseTs(s);
  return d ? d.toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
}
// minutes → "2h 15m" / "1d 4h" / "35m"
function fmtMins(m) {
  if (m == null || isNaN(m)) return '—';
  m = Math.round(Math.abs(m));
  if (m < 60) return m + 'm';
  if (m < 1440) { const h = Math.floor(m / 60), mm = m % 60; return mm ? `${h}h ${mm}m` : `${h}h`; }
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60); return h ? `${d}d ${h}h` : `${d}d`;
}

// localStorage that never throws (private mode, blocked storage).
const store = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (_) { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
};

/* SLA chip — the one-glance answer to "is this late?". Terminal / met tickets
   stay quiet; only live risk gets colour. */
// SLA is an IT-side metric: requestors (outlet users) never see it.
const canSeeSla = () => !!state.user && state.user.role !== 'Requestor';
const SLA_CLS = { 'Breached': 'sla-bad', 'At Risk': 'sla-warn', 'On Track': 'sla-ok', 'Not Started': 'sla-idle', 'Met': 'sla-met', 'N/A': 'sla-idle' };
function slaChip(t, { quiet = true } = {}) {
  const s = t.sla_status;
  if (!s || !canSeeSla()) return '';
  if (quiet && (s === 'Met' || s === 'N/A' || s === 'On Track' || ['Closed', 'Resolved', 'Cancelled'].includes(t.status) && s !== 'Breached')) return '';
  let label = s;
  const due = parseTs(t.sla_deadline_at);
  if (s === 'Breached' && t.breach_minutes) label = `Overdue ${fmtMins(t.breach_minutes)}`;
  else if ((s === 'At Risk' || s === 'On Track' || s === 'Not Started') && due) {
    const left = (due - Date.now()) / 60000;
    if (left > 0) label = `${s === 'Not Started' ? 'Unstarted · ' : ''}${fmtMins(left)} left`;
  }
  return `<span class="sla-chip ${SLA_CLS[s] || 'sla-idle'}" title="SLA ${esc(s)}${due ? ' · due ' + esc(fmtFull(t.sla_deadline_at)) : ''}">${svg(ICONS.timer, 12)}${esc(label)}</span>`;
}

/* ---- Tiny chart primitives (inline SVG, no library) --------------------- */
function sparkline(values, { w = 220, h = 48, cls = 'spark' } = {}) {
  const max = Math.max(1, ...values);
  const inset = 3; // keep round line caps inside the box
  const step = values.length > 1 ? (w - inset * 2) / (values.length - 1) : w;
  const pts = values.map((v, i) => `${(inset + i * step).toFixed(1)},${(h - 4 - (v / max) * (h - 8)).toFixed(1)}`);
  const area = `0,${h} ${pts.join(' ')} ${w},${h}`;
  return `<svg class="${cls}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><polygon class="spark-area" points="${area}"/><polyline class="spark-line" points="${pts.join(' ')}"/></svg>`;
}

/* --------------------------------------------------------------------------
   Row actions — ONE component for every table's action column, so they cannot
   drift into a mix of "Edit" / "Del" / "Deactivate" text buttons again.

   iconBtn({ icon, label, attrs, danger, disabled, title })
     • icon-only: the label is the tooltip (title) AND the accessible name
       (aria-label), never visible text
     • `attrs` carries the data-* hook the view binds its click handler to
     • `disabled` + a title explaining WHY is preferred over hiding an action
       the user can see is missing (requirement: dangerous → disabled+tooltip)
   Permissions: these helpers only shape the UI. Every action they trigger is
   re-authorised by the backend route.
   -------------------------------------------------------------------------- */
function iconBtn({ icon, label, attrs = '', danger = false, disabled = false, title = '' }) {
  const tip = title || label;
  return `<button type="button" class="act-btn${danger ? ' act-danger' : ''}"${disabled ? ' disabled' : ''}`
    + ` ${attrs} title="${esc(tip)}" aria-label="${esc(label)}">${svg(ICONS[icon], 16)}</button>`;
}
// Action <td> for a table row. Falsy entries are dropped, so a caller can pass
// `cond && iconBtn(...)` to omit an action the user may not perform.
function actionCell(...buttons) {
  const btns = buttons.filter(Boolean);
  return `<td class="row-actions"><div class="act-group">${btns.join('')}</div></td>`;
}
// Same buttons outside a table (modal lists, cards).
function actionGroup(...buttons) {
  return `<div class="act-group">${buttons.filter(Boolean).join('')}</div>`;
}

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

async function doFetch(url, init) {
  try { return await fetch(url, init); }
  catch (_) {
    throw new ApiError(navigator.onLine === false
      ? 'You are offline. Check the network and try again.'
      : 'Cannot reach the server. Check the network and try again.', 0);
  }
}
async function rawFetch(url, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (opts.body && !(opts.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const init = { credentials: 'same-origin', ...opts, headers };
  const res = await doFetch(url, init);
  if (res.status === 401 && !url.includes('/api/auth/')) {
    if (state.user) {
      const ok = await openReauth();
      if (ok) return doFetch(url, init);
      throw new ApiError('Session expired', 401);
    }
    state.user = null; renderAuth();
    throw new ApiError('Unauthorized', 401);
  }
  return res;
}
const FRIENDLY_STATUS = {
  403: 'You do not have permission to do that.',
  404: 'Not found. It may have been removed.',
  413: 'That is too large to upload.',
  429: 'Too many attempts. Please wait a moment.',
  500: 'The server hit a problem. Please try again.',
  502: 'The server is restarting. Try again in a moment.',
  503: 'The server is busy. Try again in a moment.',
};
async function apiJSON(url, opts) {
  const res = await rawFetch(url, opts);
  let data = null; try { data = await res.json(); } catch (_) {}
  if (!res.ok) throw new ApiError((data && data.error) || FRIENDLY_STATUS[res.status] || 'Request failed', res.status);
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
  assignableTechs: (id) => apiJSON('/api/tickets/' + id + '/assignable-technicians'),
  inviteCollaborator: (id, b) => apiJSON('/api/tickets/' + id + '/collaborators/invite', { method: 'POST', body: JSON.stringify(b) }),
  comment: (id, b) => apiJSON('/api/tickets/' + id + '/comments', { method: 'POST', body: JSON.stringify(b) }),
  technicians: (dept, include) => apiJSON('/api/technicians?' + new URLSearchParams({ ...(dept ? { department: dept } : {}), ...(include ? { include } : {}) })),
  schedules: (id) => apiJSON('/api/technicians/' + id + '/schedules'),
  addSchedule: (id, b) => apiJSON('/api/technicians/' + id + '/schedules', { method: 'POST', body: JSON.stringify(b) }),
  delSchedule: (id, sid) => apiJSON('/api/technicians/' + id + '/schedules/' + sid, { method: 'DELETE' }),
  addUnavail: (id, b) => apiJSON('/api/technicians/' + id + '/unavailability', { method: 'POST', body: JSON.stringify(b) }),
  delUnavail: (id, uid) => apiJSON('/api/technicians/' + id + '/unavailability/' + uid, { method: 'DELETE' }),
  dashboard: () => apiJSON('/api/dashboard'),
  report: (qs) => apiJSON('/api/reports/tickets' + (qs ? '?' + qs : '')),
  performance: (qs) => apiJSON('/api/reports/performance' + (qs ? '?' + qs : '')),
  users: () => apiJSON('/api/users'),
  importData: (module, csv, dryRun) => apiJSON('/api/import/' + module, { method: 'POST', body: JSON.stringify({ csv, dryRun }) }),
  createUser: (b) => apiJSON('/api/users', { method: 'POST', body: JSON.stringify(b) }),
  patchUser: (id, b) => apiJSON('/api/users/' + id, { method: 'PATCH', body: JSON.stringify(b) }),
  delUser: (id) => apiJSON('/api/users/' + id, { method: 'DELETE' }),
  unlockUser: (id) => apiJSON('/api/users/' + id, { method: 'PATCH', body: JSON.stringify({ unlock: true }) }),
  changePassword: (b) => apiJSON('/api/auth/change-password', { method: 'POST', body: JSON.stringify(b) }),
};


// ==========================================================================
// Modal system
// ==========================================================================
// Every open modal registers its closer so navigation can dismiss them.
const openModals = new Set();
function closeAllModals() { [...openModals].forEach((c) => c()); }
let modalSeq = 0;
function openModal({ title, bodyHTML, footHTML, onMount, onClose, size }) {
  const root = $('#modal-root');
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  const titleId = 'mt_' + (++modalSeq);
  overlay.innerHTML = `
    <div class="modal modal-${size || 'md'}" role="dialog" aria-modal="true" aria-labelledby="${titleId}">
      <div class="modal-head"><h3 id="${titleId}">${esc(title)}</h3><button class="modal-close" aria-label="Close">${svg(ICONS.x, 20)}</button></div>
      <div class="modal-body">${bodyHTML}</div>
      ${footHTML ? `<div class="modal-foot">${footHTML}</div>` : ''}
    </div>`;
  root.appendChild(overlay);
  document.body.classList.add('modal-open');
  const prevFocus = document.activeElement;
  const onKey = (e) => {
    if (overlay !== root.lastElementChild) return; // only the top-most modal reacts
    if (e.key === 'Escape') { close(); return; }
    if (e.key === 'Tab') trapFocus(e, overlay);
  };
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    openModals.delete(close);
    document.removeEventListener('keydown', onKey);
    overlay.remove();
    if (!root.querySelector('.modal-overlay')) document.body.classList.remove('modal-open');
    if (onClose) onClose();
    if (prevFocus && prevFocus.focus && document.contains(prevFocus)) prevFocus.focus();
  };
  openModals.add(close);
  // Close on a genuine backdrop click only (not a text-selection drag that ends outside).
  let downOnBackdrop = false;
  overlay.addEventListener('mousedown', (e) => { downOnBackdrop = e.target === overlay; });
  overlay.addEventListener('click', (e) => { if (e.target === overlay && downOnBackdrop) close(); });
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

/* Generic form modal → resolves with a values object, or null when cancelled.
   Field options:
     type       text | email | tel | number | date | time | datetime-local |
                textarea | select | multiselect | checkbox | toggle | password | section
     required   blocks submit when empty (with an inline message)
     showIf     (values) => boolean — field is hidden (and not validated) when false
     maxlength, placeholder, hint, rows, autocomplete, value, options */
function formModal(title, fields, submitLabel = 'Save', opts = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (v) => { if (!settled) { settled = true; resolve(v); } };
    const body = fields.map((f) => {
      if (f.type === 'section') return `<div class="form-section" data-field="${esc(f.name)}"><h4>${esc(f.label)}</h4>${f.hint ? `<p class="hint">${esc(f.hint)}</p>` : ''}</div>`;
      const id = 'fm_' + f.name;
      const common = `id="${id}" name="${esc(f.name)}"${f.maxlength ? ` maxlength="${f.maxlength}"` : ''}${f.autocomplete ? ` autocomplete="${esc(f.autocomplete)}"` : ''}${f.required ? ' aria-required="true"' : ''}`;
      let input;
      if (f.type === 'textarea') input = `<textarea ${common} rows="${f.rows || 3}" placeholder="${esc(f.placeholder || '')}">${esc(f.value || '')}</textarea>`;
      else if (f.type === 'select') input = `<select ${common}>${f.options.map((o) => `<option value="${esc(o.value)}" ${String(o.value) === String(f.value ?? '') ? 'selected' : ''}${o.disabled ? ' disabled' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
      else if (f.type === 'multiselect') {
        const sel = Array.isArray(f.value) ? f.value : [];
        input = `<div class="ms-wrap"><input type="search" class="ms-filter" placeholder="Filter…" aria-label="Filter ${esc(f.label)}">
          <div class="multiselect-box" id="${id}">${f.options.length ? f.options.map((o) => `<label class="ms-opt" data-q="${esc(String(o.label).toLowerCase())}"><input type="checkbox" value="${esc(o.value)}" ${sel.includes(o.value) ? 'checked' : ''}> ${esc(o.label)}</label>`).join('') : '<span class="muted">No options</span>'}</div>
          <div class="ms-count hint" data-count-for="${id}">${sel.length} selected</div></div>`;
      }
      else if (f.type === 'checkbox') input = `<label class="check-row"><input type="checkbox" ${common} ${f.value ? 'checked' : ''}> <span>${esc(f.checkboxLabel || '')}</span></label>`;
      else if (f.type === 'toggle') {
        const on = !!f.value;
        input = `<div class="toggle-row">
          <label class="switch"><input type="checkbox" ${common} ${on ? 'checked' : ''} role="switch" aria-checked="${on}"><span class="switch-track"><span class="switch-knob"></span></span></label>
          <div class="toggle-copy"><label for="${id}" class="toggle-name">${esc(f.checkboxLabel || f.label || 'Active')}</label>
            <div class="toggle-state" data-state-for="${id}">${on ? esc(f.onText || 'Active') : esc(f.offText || 'Inactive')}</div></div>
        </div>`;
      }
      else if (f.type === 'password') input = pwInput(id, `name="${esc(f.name)}" value="${esc(f.value || '')}" placeholder="${esc(f.placeholder || '')}" autocomplete="${esc(f.autocomplete || 'new-password')}"`);
      else input = `<input type="${f.type || 'text'}" ${common} value="${esc(f.value ?? '')}" placeholder="${esc(f.placeholder || '')}"${f.type === 'tel' ? ' inputmode="tel"' : ''}${f.type === 'email' ? ' inputmode="email" spellcheck="false"' : ''}>`;
      const hideLabel = f.type === 'checkbox' || f.type === 'toggle';
      return `<div class="field" data-field="${esc(f.name)}">${hideLabel ? '' : `<label for="${id}">${esc(f.label)}${f.required ? ' <span class="req-star" aria-hidden="true">*</span>' : ''}</label>`}${input}<div class="field-err" id="${id}_err" role="alert" hidden></div>${f.hint ? `<div class="hint">${esc(f.hint)}</div>` : ''}</div>`;
    }).join('');
    const foot = `<button type="button" class="btn-ghost" data-cancel>Cancel</button><button type="button" class="btn-primary" data-ok>${esc(submitLabel)}</button>`;
    openModal({
      title, bodyHTML: `<form class="form-modal" novalidate>${opts.intro ? `<p class="muted mb">${esc(opts.intro)}</p>` : ''}${body}<button type="submit" hidden></button></form>`, footHTML: foot, size: opts.size,
      onClose: () => settle(null),
      onMount(ov, close) {
        const inputs = fields.filter((f) => f.type !== 'section');
        const read = () => {
          const vals = {};
          for (const f of inputs) {
            const el = $('#fm_' + f.name, ov);
            if (!el) continue;
            if (f.type === 'checkbox' || f.type === 'toggle') vals[f.name] = el.checked;
            else if (f.type === 'multiselect') vals[f.name] = $$('input[type=checkbox]', el).filter((c) => c.checked).map((c) => c.value);
            else vals[f.name] = el.value.trim();
          }
          return vals;
        };
        const applyVisibility = () => {
          const vals = read();
          for (const f of fields) {
            if (!f.showIf) continue;
            const wrap = $(`[data-field="${CSS.escape(f.name)}"]`, ov);
            if (wrap) wrap.hidden = !f.showIf(vals);
          }
        };
        applyVisibility();
        ov.addEventListener('change', applyVisibility);
        $('[data-cancel]', ov).addEventListener('click', close);
        for (const f of inputs.filter((x) => x.type === 'toggle')) {
          const box = $('#fm_' + f.name, ov);
          const out = $(`[data-state-for="fm_${f.name}"]`, ov);
          if (box && out) box.addEventListener('change', () => {
            out.textContent = box.checked ? (f.onText || 'Active') : (f.offText || 'Inactive');
            box.setAttribute('aria-checked', String(box.checked));
          });
        }
        for (const f of inputs.filter((x) => x.type === 'multiselect')) {
          const box = $('#fm_' + f.name, ov);
          const wrap = box.closest('.ms-wrap');
          $('.ms-filter', wrap).addEventListener('input', (e) => {
            const q = e.target.value.trim().toLowerCase();
            $$('.ms-opt', box).forEach((o) => { o.hidden = !!q && !o.dataset.q.includes(q); });
          });
          box.addEventListener('change', () => {
            $(`[data-count-for="fm_${f.name}"]`, wrap).textContent = `${$$('input:checked', box).length} selected`;
          });
        }
        const submit = () => {
          const vals = read();
          let firstBad = null;
          for (const f of inputs) {
            const errEl = $(`#fm_${f.name}_err`, ov);
            if (errEl) errEl.hidden = true;
            const wrap = $(`[data-field="${CSS.escape(f.name)}"]`, ov);
            if (!f.required || (wrap && wrap.hidden)) continue;
            const empty = f.type === 'multiselect' ? !vals[f.name].length : (f.type === 'checkbox' || f.type === 'toggle') ? false : !vals[f.name];
            if (empty) {
              if (errEl) { errEl.textContent = `${f.label} is required`; errEl.hidden = false; }
              firstBad = firstBad || $('#fm_' + f.name, ov);
            }
          }
          if (firstBad) { firstBad.focus && firstBad.focus(); return; }
          // Hidden fields are not part of the answer.
          for (const f of fields) {
            const wrap = $(`[data-field="${CSS.escape(f.name)}"]`, ov);
            if (f.showIf && wrap && wrap.hidden) delete vals[f.name];
          }
          settle(vals);
          close();
        };
        $('[data-ok]', ov).addEventListener('click', submit);
        $('form', ov).addEventListener('submit', (e) => { e.preventDefault(); submit(); });
      },
    });
  });
}

// Re-auth modal (session expiry mid-action)
function openReauth() {
  if (reauthInFlight) return reauthInFlight;
  reauthInFlight = new Promise((resolve) => {
    let result = false;
    openModal({
      title: 'Session expired',
      size: 'sm',
      bodyHTML: `<form id="reauth-form" novalidate>
        <p class="muted mb">For your security you were signed out. Enter your password to continue where you left off.</p>
        <div class="field"><label for="reauth-email">Email</label><input id="reauth-email" value="${esc(state.user ? state.user.email : '')}" autocomplete="username" readonly></div>
        <div class="field"><label for="reauth-pw">Password</label>${pwInput('reauth-pw', 'autofocus autocomplete="current-password"')}</div>
        <div class="field-err" id="reauth-err" role="alert" hidden></div>
        <button type="submit" hidden></button></form>`,
      footHTML: `<button type="button" class="btn-ghost" data-out>Sign out</button><button type="button" class="btn-primary" data-go>Continue</button>`,
      onClose: () => {
        reauthInFlight = null;
        resolve(result);
        if (!result) { state.user = null; renderAuth(); }
      },
      onMount(ov, close) {
        const go = $('[data-go]', ov);
        const err = $('#reauth-err', ov);
        $('[data-out]', ov).addEventListener('click', () => { close(); doLogout(); });
        const submit = async () => {
          const pw = $('#reauth-pw', ov).value;
          if (!pw) { err.textContent = 'Enter your password'; err.hidden = false; return; }
          go.disabled = true; go.textContent = 'Checking…';
          try {
            await api.login(state.user.email, pw);
            result = true;
            toast('Session restored', 'success');
            close();
          } catch (e) {
            err.textContent = e.status === 401 ? 'Wrong password' : e.message;
            err.hidden = false;
            go.disabled = false; go.textContent = 'Continue';
          }
        };
        go.addEventListener('click', submit);
        $('#reauth-form', ov).addEventListener('submit', (e) => { e.preventDefault(); submit(); });
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
      if (this.items.length >= 5) { toast('You can attach up to 5 files', 'error'); return; }
      const isImg = file.type.startsWith('image/'), isVid = file.type.startsWith('video/');
      if (!isImg && !isVid) { toast(`${file.name}: only photos and videos are supported`, 'error'); continue; }
      if (isImg && file.size > 10 * 1024 * 1024) { toast(`${file.name} is over the 10 MB photo limit`, 'error'); continue; }
      if (isVid && file.size > 100 * 1024 * 1024) { toast(`${file.name} is over the 100 MB video limit`, 'error'); continue; }
      const it = { uid: Math.random().toString(36).slice(2), file, name: file.name, size: file.size, type: file.type, id: null, state: 'uploading', xhr: null };
      this.items.push(it); this.renderItem(it); this.start(it);
    }
  }
  renderItem(it) {
    const card = document.createElement('div');
    card.className = 'preview-card'; card.id = 'pc_' + it.uid;
    card.innerHTML = `<button type="button" class="pc-remove" title="Remove" aria-label="Remove ${esc(it.name)}">${svg(ICONS.x, 14)}</button>
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
    $('.pc-retry', e).setAttribute('type', 'button');
    $('.pc-retry', e).addEventListener('click', (ev) => { ev.stopPropagation(); e.hidden = true; it.state = 'uploading'; this.start(it); });
  }
  start(it) { it.type.startsWith('video/') ? this.chunked(it) : this.direct(it); }
  direct(it) {
    const xhr = new XMLHttpRequest(); it.xhr = xhr;
    xhr.open('POST', '/api/attachments/upload');
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) { const b = this.bar(it); if (b) b.style.width = Math.round(e.loaded / e.total * 100) + '%'; } };
    xhr.onload = () => {
      if (xhr.status === 201) { it.id = JSON.parse(xhr.responseText).id; it.state = 'done'; this.markDone(it); }
      else if (xhr.status === 401) this.setErr(it, 'Session expired. Sign in again and retry');
      else this.setErr(it, this.err(xhr));
    };
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
          else { it.id = JSON.parse(xhr.responseText).id; it.state = 'done'; this.markDone(it); }
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
  markDone(it) { const c = $('#pc_' + it.uid, this.list); if (c) { c.classList.add('is-done'); const b = $('.pc-bar', c); if (b) b.style.width = '100%'; } }
  err(xhr) { try { return JSON.parse(xhr.responseText).error; } catch (_) { return xhr.status === 413 ? 'File too large' : 'Upload failed'; } }
  remove(it) { if (it.xhr) it.xhr.abort(); if (it.id) rawFetch('/api/attachments/' + it.id, { method: 'DELETE' }).catch(() => {}); this.items = this.items.filter((x) => x !== it); const c = $('#pc_' + it.uid, this.list); if (c) c.remove(); }
  uploading() { return this.items.some((i) => i.state === 'uploading'); }
  ids() { return this.items.filter((i) => i.state === 'done').map((i) => i.id); }
  clear() { this.items.forEach((i) => { if (i.xhr) i.xhr.abort(); }); this.items = []; this.list.innerHTML = ''; }
  // Form abandoned: stop uploads and remove the drafts from the server.
  discard() { this.items.forEach((i) => { i.state = 'error'; if (i.xhr) i.xhr.abort(); if (i.id) rawFetch('/api/attachments/' + i.id, { method: 'DELETE' }).catch(() => {}); }); this.items = []; }
}
function uploadZoneHTML(id) {
  return `<div class="upload-zone" id="${id}">
    <input type="file" multiple accept="image/*,video/mp4,video/webm,video/quicktime">
    ${svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>', 26)}
    <p><b>Add photos or video</b> <span class="hide-sm">— or drop them here</span></p>
    <p class="hint">Photos up to 10 MB · videos up to 100 MB · max 5</p>
  </div><div class="preview-list" id="${id}-list"></div>`;
}

// ==========================================================================
// Auth screens
// ==========================================================================
function brandBlock(sub) {
  return `<div class="auth-brand"><div class="brand-mark">${svg(ICONS.ticket, 20)}</div>
    <div class="auth-brand-text"><span class="brand-text">IT Ticketing</span>${sub ? `<span class="brand-sub">${esc(sub)}</span>` : ''}</div></div>`;
}
// Only same-app paths are accepted as a post-login destination.
function safeRedirect(p) {
  return typeof p === 'string' && /^\/(?!\/)[\w\-/?=&%.]*$/.test(p) && !p.startsWith('/login') ? p : null;
}
function renderAuth() {
  closeAllModals();
  stopAutoRefresh();
  $('#app-shell').hidden = true;
  const root = $('#auth-root'); root.hidden = false;
  document.title = 'Sign in · IT Ticketing';
  const wanted = location.pathname !== '/' && location.pathname !== '/login' ? location.pathname + location.search : '';
  if (wanted) history.replaceState(null, '', '/login?redirect=' + encodeURIComponent(wanted));
  root.innerHTML = `
    <div class="auth-layout">
      <aside class="auth-hero" aria-hidden="true">
        <div class="auth-hero-inner">
          ${brandBlock('IT Support')}
          <h1>IT Helpdesk</h1>
          <p>Sign in to submit and follow up on IT requests for your outlet.</p>
        </div>
      </aside>
      <main class="auth-main">
        <form class="auth-card" id="login-form" novalidate>
          <div class="auth-mobile-brand">${brandBlock('IT Support')}</div>
          <h2 class="auth-title">Sign in</h2>
          <p class="auth-sub">Use your work email and password.</p>
          <div class="field"><label for="li-email">Email</label><input type="email" id="li-email" required autocomplete="username" inputmode="email" spellcheck="false" autofocus></div>
          <div class="field"><label for="li-pw">Password</label>${pwInput('li-pw', 'required autocomplete="current-password"')}</div>
          <label class="remember-row"><input type="checkbox" id="li-remember"><span>Keep me signed in on this device (14 days)</span></label>
          <div class="form-alert" id="li-err" role="alert" hidden></div>
          <button type="submit" class="btn-primary btn-block btn-lg" id="li-submit">Sign in</button>
          <p class="auth-foot muted">Forgot your password? Contact your IT admin.</p>
        </form>
      </main>
    </div>`;
  wireNavLinks();
  const form = $('#login-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('#li-email').value.trim();
    const pw = $('#li-pw').value;
    const errBox = $('#li-err');
    errBox.hidden = true;
    if (!email || !pw) { errBox.textContent = 'Enter your email and password.'; errBox.hidden = false; return; }
    const btn = $('#li-submit'); btn.disabled = true; btn.textContent = 'Signing in…';
    try {
      state.user = await api.login(email, pw, $('#li-remember').checked);
      const dest = safeRedirect(new URLSearchParams(location.search).get('redirect'));
      boot();
      navigate(dest || defaultRoute(), { replace: true });
    } catch (err) {
      errBox.textContent = err.message || 'Sign-in failed';
      errBox.hidden = false;
      btn.disabled = false; btn.textContent = 'Sign in';
      $('#li-pw').select();
    }
  });
}

// ==========================================================================
// Public Quick Report (no login) — only creates a New ticket
// ==========================================================================
function publicShell(inner) {
  return `<div class="public-wrap"><div class="auth-card public-card" id="pq-card">${inner}</div></div>`;
}
async function renderPublicQuickReport() {
  closeAllModals();
  stopAutoRefresh();
  $('#app-shell').hidden = true;
  const root = $('#auth-root'); root.hidden = false;
  document.title = 'Quick Report · IT Ticketing';
  root.innerHTML = publicShell(`${brandBlock('Quick Report')}<div class="loading-inline"><span class="spinner sm"></span> Memuat formulir…</div>`);
  let meta;
  try { meta = await api.publicMeta(); }
  catch (e) {
    $('#pq-card').innerHTML = `${brandBlock('Quick Report')}<div class="empty"><h3>Gagal memuat formulir</h3><p>${esc(e.message || 'Coba lagi.')}</p></div>
      <button type="button" class="btn-primary btn-block" id="pq-retry">${svg(ICONS.refresh, 16)} Coba lagi</button>
      <a href="/login" data-nav class="btn-ghost btn-block mt">← Kembali ke login</a>`;
    $('#pq-retry').addEventListener('click', renderPublicQuickReport);
    wireNavLinks(); return;
  }

  const groups = {};
  (meta.outlets || []).forEach((o) => { (groups[o.brand_code] = groups[o.brand_code] || []).push(o); });
  const lastOutlet = store.get('pqOutlet', '');
  const optgroups = Object.entries(groups).map(([b, list]) => `<optgroup label="${esc(b)}">${list.map((o) => `<option value="${esc(o.code)}" ${o.code === lastOutlet ? 'selected' : ''}>${esc(o.code)}${o.name && o.name !== o.code ? ' · ' + esc(o.name) : ''}${o.region ? ' · ' + esc(o.region) : ''}</option>`).join('')}</optgroup>`).join('');

  $('#pq-card').innerHTML = `
    ${brandBlock('Quick Report')}
    <h2 class="auth-title">Laporkan kendala</h2>
    <p class="auth-sub">Tanpa login. Tim IT akan menindaklanjuti.</p>
    <form id="pq-form" novalidate>
      <div class="field"><label for="pq-outlet">Outlet <span class="req-star">*</span></label><select id="pq-outlet" required><option value="">Pilih outlet…</option>${optgroups}</select></div>
      <div class="field"><span class="label">Departemen <span class="req-star">*</span></span>
        <div class="segmented" role="radiogroup" aria-label="Departemen">
          <button type="button" class="seg-btn big" role="radio" aria-checked="false" data-pqdept="IT">${svg(ICONS.monitor, 22)}<span>IT<small>POS, printer, jaringan</small></span></button>
          <button type="button" class="seg-btn big" role="radio" aria-checked="false" data-pqdept="ME">${svg(ICONS.wrench, 22)}<span>Mechanical<small>AC, listrik, bangunan</small></span></button>
        </div></div>
      <div class="field"><label for="pq-cat">Kategori <span class="req-star">*</span></label><select id="pq-cat" disabled><option value="">Pilih departemen dulu</option></select></div>
      <div class="field"><label for="pq-desc">Deskripsi masalah <span class="req-star">*</span></label><textarea id="pq-desc" maxlength="5000" placeholder="mis. printer kasir 2 tidak keluar struk sejak pagi"></textarea><div class="hint char-hint" data-count="pq-desc"></div></div>
      <div class="field-row">
        <div class="field"><label for="pq-name">Nama pelapor <span class="req-star">*</span></label><input id="pq-name" maxlength="120" autocomplete="name" value="${esc(store.get('pqName', ''))}"></div>
        <div class="field"><label for="pq-contact">WhatsApp <span class="req-star">*</span></label><input id="pq-contact" maxlength="40" placeholder="08xx…" inputmode="tel" autocomplete="tel" value="${esc(store.get('pqContact', ''))}"></div>
      </div>
      <div class="field"><span class="label">Urgensi</span><div class="segmented seg-urg" id="pq-urg" role="radiogroup" aria-label="Urgensi">${URGENCIES.map((u) => `<button type="button" role="radio" aria-checked="${u === 'Medium'}" class="seg-btn urg-${u} ${u === 'Medium' ? 'active' : ''}" data-pqurg="${u}">${u}</button>`).join('')}</div>
        <div class="hint">Critical = operasional berhenti (mis. tidak bisa transaksi).</div></div>
      <div class="field"><label for="pq-loc">Lokasi di dalam outlet</label><input id="pq-loc" maxlength="255" placeholder="mis. area kasir depan"></div>
      <div class="field"><span class="label">Foto / video</span>
        <label class="upload-zone upload-compact" for="pq-file">${svg(ICONS.upload, 22)}<span>Tambah foto / video (maks. 5)</span>
          <input type="file" id="pq-file" accept="image/*,video/mp4,video/webm,video/quicktime" multiple></label>
        <div class="pq-uploads" id="pq-uplist"></div>
      </div>
      <div class="form-alert" id="pq-err" role="alert" hidden></div>
      <button type="submit" class="btn-primary btn-block btn-lg" id="pq-submit">Kirim laporan</button>
      <a href="/login" data-nav class="auth-switch">← Staff login</a>
    </form>`;
  wireNavLinks();
  wireCharCounters($('#pq-card'));

  let dept = '';
  $$('[data-pqdept]').forEach((b) => b.addEventListener('click', () => {
    dept = b.dataset.pqdept;
    $$('[data-pqdept]').forEach((x) => { x.classList.toggle('active', x === b); x.setAttribute('aria-checked', String(x === b)); });
    const sel = $('#pq-cat'); const list = (meta.categories && meta.categories[dept]) || [];
    sel.innerHTML = '<option value="">Pilih kategori…</option>' + list.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    sel.disabled = false;
    sel.focus();
  }));
  let urg = 'Medium';
  $$('[data-pqurg]').forEach((b) => b.addEventListener('click', () => {
    urg = b.dataset.pqurg;
    $$('[data-pqurg]').forEach((x) => { x.classList.toggle('active', x === b); x.setAttribute('aria-checked', String(x === b)); });
  }));

  // Lightweight public uploader — posts each file to /api/public/upload.
  const uploadedIds = [];
  let uploading = 0;
  $('#pq-file').addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    for (const f of files) {
      if (uploadedIds.length + uploading >= 5) { toast('Maksimal 5 file', 'error'); break; }
      const isVid = f.type.startsWith('video/');
      if (!f.type.startsWith('image/') && !isVid) { toast(`${f.name}: format tidak didukung`, 'error'); continue; }
      if (f.size > (isVid ? 100 : 10) * 1024 * 1024) { toast(`${f.name}: terlalu besar (maks. ${isVid ? 100 : 10} MB)`, 'error'); continue; }
      const row = document.createElement('div'); row.className = 'pq-uprow is-busy';
      row.innerHTML = `<span class="spinner xs"></span><span class="pq-upname">${esc(f.name)}</span><span class="muted">${fmtBytes(f.size)}</span>`;
      $('#pq-uplist').appendChild(row);
      uploading++;
      try {
        const fd = new FormData(); fd.append('file', f);
        const res = await rawFetch('/api/public/upload', { method: 'POST', body: fd });
        let data = {}; try { data = await res.json(); } catch (_) {}
        if (!res.ok) throw new Error(data.error || 'Upload gagal');
        uploadedIds.push(data.id);
        row.className = 'pq-uprow is-done';
        row.innerHTML = `${svg(ICONS.checkCircle2, 16)}<span class="pq-upname">${esc(f.name)}</span><button type="button" class="link-btn" aria-label="Hapus ${esc(f.name)}">Hapus</button>`;
        $('button', row).addEventListener('click', () => { const i = uploadedIds.indexOf(data.id); if (i >= 0) uploadedIds.splice(i, 1); row.remove(); });
      } catch (err) {
        row.className = 'pq-uprow err';
        row.innerHTML = `${svg(ICONS.alertTriangle, 16)}<span class="pq-upname">${esc(f.name)}: ${esc(err.message)}</span>`;
      } finally { uploading--; }
    }
  });

  const submit = $('#pq-submit');
  const errBox = $('#pq-err');
  let submitted = false;
  $('#pq-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (submitted) return;
    const outlet = $('#pq-outlet').value, cat = $('#pq-cat').value, desc = $('#pq-desc').value.trim();
    const name = $('#pq-name').value.trim(), contact = $('#pq-contact').value.trim();
    const fail = (msg, el) => { errBox.textContent = msg; errBox.hidden = false; if (el) el.focus(); };
    errBox.hidden = true;
    if (!outlet) return fail('Pilih outlet.', $('#pq-outlet'));
    if (!dept) return fail('Pilih IT atau Mechanical.', $('[data-pqdept]'));
    if (!cat) return fail('Pilih kategori.', $('#pq-cat'));
    if (!desc) return fail('Isi deskripsi masalah.', $('#pq-desc'));
    if (!name) return fail('Isi nama pelapor.', $('#pq-name'));
    if (!/^\+?[\d\s().-]{8,20}$/.test(contact)) return fail('Isi nomor WhatsApp yang valid (mis. 0812…).', $('#pq-contact'));
    if (uploading > 0) return fail('Tunggu unggahan selesai.');
    submitted = true; submit.disabled = true; submit.textContent = 'Mengirim…';
    try {
      const r = await api.publicQuickReport({
        department: dept, outlet_code: outlet, category: cat, description: desc,
        reporter_name: name, contact_number: contact, urgency: urg,
        location_detail: $('#pq-loc').value.trim(), attachmentIds: uploadedIds,
      });
      store.set('pqOutlet', outlet); store.set('pqName', name); store.set('pqContact', contact);
      renderPublicSuccess(r);
    } catch (err) {
      submitted = false; submit.disabled = false; submit.textContent = 'Kirim laporan';
      fail(err.message || 'Gagal mengirim');
    }
  });
}

function renderPublicSuccess(r) {
  const trackUrl = location.origin + (r.track_url || '');
  $('#pq-card').innerHTML = `
    ${brandBlock('Quick Report')}
    <div class="pq-success">
      <div class="pq-check">${svg(ICONS.checkCircle2, 34)}</div>
      <h2>Laporan terkirim</h2>
      <p class="muted">Simpan nomor tiket ini. Tim terkait akan segera menindaklanjuti.</p>
      <div class="pq-ticketno">${esc(r.ticket_number)}</div>
      ${r.tracking_token ? `<label class="hint" for="pq-trackurl">Link untuk melacak status (juga dikirim via WhatsApp):</label>
      <div class="pq-track"><input id="pq-trackurl" readonly value="${esc(trackUrl)}"><button type="button" class="btn-outline" id="pq-copy">${svg(ICONS.link, 15)} Salin</button></div>
      <a class="btn-primary btn-block mt" href="${esc(r.track_url)}" data-nav>Lihat status tiket</a>` : ''}
      <div class="row gap-sm mt center">
        <a href="/quick-report" data-nav class="btn-outline">Laporan baru</a>
        <a href="/login" data-nav class="btn-ghost">Staff login</a>
      </div>
    </div>`;
  wireNavLinks();
  const copyBtn = $('#pq-copy');
  if (copyBtn) copyBtn.addEventListener('click', () => copyText($('#pq-trackurl').value, 'Link disalin'));
}

// Clipboard with a fallback for plain-HTTP (non-secure) intranet origins.
async function copyText(text, okMsg = 'Copied') {
  try {
    if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(text);
    else {
      const ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
    }
    toast(okMsg, 'success');
  } catch (_) { toast('Copy failed. Select and copy manually', 'error'); }
}

const PUBLIC_STEPS = ['New', 'Open', 'On Progress', 'Closed'];
async function renderPublicTrack(ticketNumber) {
  closeAllModals();
  stopAutoRefresh();
  $('#app-shell').hidden = true;
  const root = $('#auth-root'); root.hidden = false;
  document.title = 'Status Tiket · IT Ticketing';
  const token = new URLSearchParams(location.search).get('token') || '';
  root.innerHTML = publicShell(`${brandBlock('Status Tiket')}<div class="loading-inline"><span class="spinner sm"></span> Melacak tiket…</div>`);
  const card = $('#pq-card');
  if (!ticketNumber || !token) {
    card.innerHTML = `${brandBlock('Status Tiket')}<div class="empty"><h3>Link pelacakan tidak valid</h3><p>Buka link lengkap yang dikirim via WhatsApp.</p></div><a href="/quick-report" data-nav class="btn-outline btn-block">Buat laporan baru</a>`;
    wireNavLinks(); return;
  }
  try {
    const t = await api.publicTrack(decodeURIComponent(ticketNumber), token);
    const g = statusGroup(t.status);
    const stepIdx = g === 'Cancelled' ? -1 : PUBLIC_STEPS.indexOf(g);
    const labels = { 'New': 'Diterima', 'Open': 'Diproses', 'On Progress': 'Dikerjakan', 'Closed': 'Selesai' };
    card.innerHTML = `
      ${brandBlock('Status Tiket')}
      <div class="pq-ticketno">${esc(t.ticket_number)}</div>
      <div class="track-status">${badge(t.status)}</div>
      ${g === 'Cancelled' ? '<p class="muted center">Tiket ini dibatalkan.</p>' : `<ol class="steps">${PUBLIC_STEPS.map((s, i) => `<li class="${i < stepIdx ? 'done' : i === stepIdx ? 'current' : ''}"><span class="step-dot">${i < stepIdx ? svg(ICONS.checkCircle2, 14) : i + 1}</span><span>${labels[s]}</span></li>`).join('')}</ol>`}
      <dl class="info-list">
        <dt>Departemen</dt><dd>${deptTag(t.department)} ${esc(t.category || '')}</dd>
        <dt>Outlet</dt><dd>${esc(t.outlet || '—')}${t.region ? ' · ' + esc(t.region) : ''}</dd>
        <dt>Teknisi</dt><dd>${t.technician_assigned ? 'Sudah ditugaskan' : 'Menunggu penugasan'}</dd>
        ${t.scheduled_at ? `<dt>Jadwal</dt><dd>${esc(fmtFull(t.scheduled_at))}</dd>` : ''}
        <dt>Dibuat</dt><dd>${fmtFull(t.created_at)}</dd>
        ${t.resolved_at ? `<dt>Selesai</dt><dd>${fmtFull(t.resolved_at)}</dd>` : ''}
        <dt>Update terakhir</dt><dd>${fmtFull(t.last_update_at)} <span class="muted">(${timeAgo(t.last_update_at)})</span></dd>
      </dl>
      <button type="button" class="btn-outline btn-block mt" id="pt-refresh">${svg(ICONS.refresh, 16)} Perbarui status</button>
      <a href="/quick-report" data-nav class="btn-ghost btn-block">Buat laporan baru</a>`;
    $('#pt-refresh').addEventListener('click', () => renderPublicTrack(ticketNumber));
    wireNavLinks();
  } catch (e) {
    card.innerHTML = `${brandBlock('Status Tiket')}<div class="empty"><h3>Tiket tidak ditemukan</h3><p>${esc(e.message || 'Token tidak valid.')}</p></div><a href="/quick-report" data-nav class="btn-outline btn-block">Buat laporan baru</a>`;
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
const ROLE_LABEL = {
  SuperAdmin: 'Super Admin', AdminIT: 'IT Admin', AdminME: 'ME Admin',
  TechnicianIT: 'IT Technician', TechnicianME: 'ME Technician', Requestor: 'Requestor', Leader: 'Leader (view-only)',
};
function boot() {
  $('#auth-root').hidden = true;
  $('#app-shell').hidden = false;
  const u = state.user;
  $('#user-avatar').textContent = techInitials(u.username);
  $('#user-name').textContent = u.username;
  $('#user-role').textContent = ROLE_LABEL[u.role] || u.role;
  $('#btn-report-quick').hidden = !CAN_CREATE.includes(u.role);
  document.body.dataset.role = u.role;
  renderNav();
}
function renderNav() {
  const keys = NAV[state.user.role] || ['tickets'];
  $('#nav-menu').innerHTML = keys.map((k) =>
    `<a href="/${k}" class="nav-item" data-route="${k}">${svg(ICONS[NAV_META[k].icon], 19)}<span>${navLabel(k)}</span></a>`).join('');
  const bottom = BOTTOM_NAV_ORDER.filter((k) => keys.includes(k)).slice(0, 4);
  const extra = keys.filter((k) => !bottom.includes(k));
  $('#bottom-nav').innerHTML = bottom.map((k) =>
    `<a href="/${k}" class="bn-item" data-route="${k}">${svg(ICONS[NAV_META[k].icon], 22)}<span>${navShort(k)}</span></a>`).join('')
    + (extra.length ? `<button type="button" class="bn-item" data-more>${svg(ICONS.menu, 22)}<span>More</span></button>` : '');
  $$('[data-route]').forEach((b) => b.addEventListener('click', (e) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return; // allow open-in-new-tab
    e.preventDefault();
    navigate('/' + b.dataset.route);
    closeDrawer();
  }));
  const more = $('[data-more]'); if (more) more.addEventListener('click', openDrawer);
}
function navLabel(k) {
  if (k === 'tickets' && state.user.role === 'Requestor') return 'My Tickets';
  if (k === 'tickets' && state.user.role.startsWith('Technician')) return 'My Jobs';
  return NAV_META[k].label;
}
function navShort(k) {
  return ({ reports: 'Reports', importexport: 'Import' })[k] || navLabel(k);
}
function setActiveNav(name, title) {
  $$('.nav-item, .bn-item').forEach((b) => {
    const on = b.dataset.route === name;
    b.classList.toggle('active', on);
    if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  const t = title || (name === 'tickets' ? navLabel('tickets') : (NAV_META[name] ? NAV_META[name].label : 'Ticket'));
  $('#page-title').textContent = t;
  document.title = `${t} · IT Ticketing`;
}
function openDrawer() {
  $('#app-shell').classList.add('drawer-open'); $('#drawer-overlay').hidden = false;
  const first = $('#nav-menu .nav-item'); if (first) first.focus();
}
function closeDrawer() { $('#app-shell').classList.remove('drawer-open'); $('#drawer-overlay').hidden = true; }

// ==========================================================================
// Router
// ==========================================================================
function navigate(path, { replace = false } = {}) {
  if (replace) history.replaceState(null, '', path); else history.pushState(null, '', path);
  route();
}
window.addEventListener('popstate', route);

// Views that poll register here; any navigation stops them.
let refreshTimer = null;
function stopAutoRefresh() { if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; } }
function startAutoRefresh(fn, ms = 60000) {
  stopAutoRefresh();
  refreshTimer = setInterval(() => { if (document.visibilityState === 'visible') fn(); }, ms);
}

async function route() {
  const path = location.pathname;
  const parts = path.split('/').filter(Boolean);
  closeAllModals();
  closeSchedPopover();
  stopAutoRefresh();
  // Public (no-login) quick report is disabled: every user must sign in.
  // if (parts[0] === 'quick-report' || parts[0] === 'report') return renderPublicQuickReport();
  // if (parts[0] === 'track') return renderPublicTrack(parts[1] || '');
  if (!state.user) {
    if (path === '/register') history.replaceState(null, '', '/login');
    return renderAuth();
  }
  if ($('#app-shell').hidden) boot();
  if (parts[0] === 'login') return navigate(safeRedirect(new URLSearchParams(location.search).get('redirect')) || defaultRoute(), { replace: true });
  const name = parts[0] || defaultRoute().slice(1);
  const id = parts[1] || null;
  window.scrollTo(0, 0);

  // RBAC route guard (mirrors the backend, which remains the enforcer)
  const allowed = NAV[state.user.role] || [];
  if (name === 'tickets' && id) {
    state.route = { name: 'ticket', id };
    setActiveNav('tickets', 'Ticket');
    animateViewIn();
    return renderTicketDetail(id);
  }
  if (!allowed.includes(name)) {
    if (NAV_META[name]) {
      state.route = { name, id: null };
      setActiveNav(name);
      animateViewIn();
      return renderAccessDenied();
    }
    return navigate(defaultRoute(), { replace: true });
  }
  state.route = { name, id };
  setActiveNav(name);
  animateViewIn();
  const map = {
    dashboard: renderDashboard,
    tickets: renderTickets,
    schedules: renderSchedules,
    reports: renderReports,
    users: renderUsers,
    categories: renderCategories,
    locations: renderLocations,
    importexport: renderImportExport,
  };
  (map[name] || renderDashboard)();
}

function renderAccessDenied() {
  $('#page-title').textContent = 'Access denied';
  view().innerHTML = `
    <div class="empty empty-lg">
      <div class="empty-icon danger">${svg(ICONS.lock, 30)}</div>
      <h3>You don't have access to this page</h3>
      <p>Your role (${esc(ROLE_LABEL[state.user.role] || state.user.role)}) can't open it. Ask an administrator if you need it.</p>
      <button class="btn-primary" id="btn-denied-home">Go to ${esc(navLabel(defaultRoute().slice(1)))}</button>
    </div>`;
  $('#btn-denied-home').addEventListener('click', () => navigate(defaultRoute()));
}

// Retrigger the entrance animation on the view container each route change
function animateViewIn() {
  const v = view();
  v.classList.remove('view-anim');
  void v.offsetWidth; // reflow so the animation restarts
  v.classList.add('view-anim');
}

// ==========================================================================
// View: Dashboard — BI style (filters → KPIs → visuals → detail)
// ==========================================================================
const q = (o) => '/tickets?' + new URLSearchParams(o).toString();
const cssVar = (name) => getComputedStyle(document.body).getPropertyValue(name).trim();
const STAGE_VAR = { 'New': '--blue', 'Open': '--violet', 'On Progress': '--amber', 'Closed': '--green', 'Cancelled': '--slate' };
const STAGES = ['New', 'Open', 'On Progress', 'Closed', 'Cancelled'];
const DASH_PRESETS = [
  ['today', 'Today'], ['7d', 'Last 7 days'], ['30d', 'Last 30 days'], ['90d', 'Last 90 days'],
  ['mtd', 'This month'], ['lastm', 'Last month'], ['qtd', 'This quarter'], ['ytd', 'Year to date'],
  ['12m', 'Last 12 months'], ['custom', 'Custom range…'],
];
const DIM_KEYS = ['department', 'region', 'brand', 'outlet', 'category', 'urgency', 'technician', 'stage', 'source'];
const DIM_LABEL = {
  department: 'Department', region: 'Region', brand: 'Brand', outlet: 'Outlet', category: 'Category',
  urgency: 'Urgency', technician: 'Technician', stage: 'Stage', source: 'Source',
};
const SOURCE_LABEL = { authenticated: 'Staff / requestor', public_quick_report: 'Public quick report' };
const dash = {
  f: { preset: '30d', from: '', to: '' },
  data: null,
  table: {},     // card id → table view on
  expanded: {},  // card id → full width
  detailPage: 1,
  seq: 0,
};

function presetRange(key) {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
  const iso = (dt) => localISO(dt);
  const back = (days) => iso(new Date(y, m, d - days));
  switch (key) {
    case 'today': return [iso(now), iso(now)];
    case '7d': return [back(6), iso(now)];
    case '90d': return [back(89), iso(now)];
    case 'mtd': return [iso(new Date(y, m, 1)), iso(now)];
    case 'lastm': return [iso(new Date(y, m - 1, 1)), iso(new Date(y, m, 0))];
    case 'qtd': return [iso(new Date(y, Math.floor(m / 3) * 3, 1)), iso(now)];
    case 'ytd': return [iso(new Date(y, 0, 1)), iso(now)];
    case '12m': return [iso(new Date(y - 1, m, d + 1)), iso(now)];
    default: return [back(29), iso(now)];
  }
}
function dashQuery(extra = {}) {
  const p = new URLSearchParams();
  const f = dash.f;
  const [from, to] = f.preset === 'custom' ? [f.from, f.to] : presetRange(f.preset);
  if (from) p.set('from', from);
  if (to) p.set('to', to);
  for (const k of DIM_KEYS) if (f[k]) p.set(k, f[k]);
  for (const [k, v] of Object.entries(extra)) p.set(k, v);
  return p;
}
// URL ⇄ state: the address bar always describes the current view (shareable).
function readDashUrl() {
  const sp = new URLSearchParams(location.search);
  const f = { preset: store.get('dashPreset', '30d'), from: '', to: '' };
  if (sp.get('preset') && DASH_PRESETS.some(([k]) => k === sp.get('preset'))) f.preset = sp.get('preset');
  if (sp.get('from') || sp.get('to')) { f.preset = 'custom'; f.from = sp.get('from') || ''; f.to = sp.get('to') || ''; }
  for (const k of DIM_KEYS) if (sp.get(k)) f[k] = sp.get(k).slice(0, 80);
  if (f.preset === 'custom' && !f.from && !f.to) f.preset = '30d';
  dash.f = f;
}
function writeDashUrl() {
  const p = new URLSearchParams();
  if (dash.f.preset === 'custom') { if (dash.f.from) p.set('from', dash.f.from); if (dash.f.to) p.set('to', dash.f.to); }
  else if (dash.f.preset !== '30d') p.set('preset', dash.f.preset);
  for (const k of DIM_KEYS) if (dash.f[k]) p.set(k, dash.f[k]);
  const qs = p.toString();
  history.replaceState(null, '', '/dashboard' + (qs ? '?' + qs : ''));
  if (dash.f.preset !== 'custom') store.set('dashPreset', dash.f.preset);
}
function activeDims() { return DIM_KEYS.filter((k) => dash.f[k]); }
function dimValueLabel(k, v) {
  if (k === 'technician') {
    if (v === 'none') return 'Unassigned';
    const t = dash.data && dash.data.options.technicians.find((x) => String(x.id) === String(v));
    return t ? t.name : `#${v}`;
  }
  if (k === 'source') return SOURCE_LABEL[v] || v;
  return v;
}
function setDashFilter(patch, label) {
  Object.assign(dash.f, patch);
  dash.detailPage = 1;
  writeDashUrl();
  loadDashboard();
  if (label) toast(`Filtered: ${label}`, 'info');
}

// ---- KPI tile ---------------------------------------------------------------
function kpiTile({ label, value, display, prev, better = 'up', spark, icon, tone = '', goto, hint, suffix = '' }) {
  let delta = '';
  if (prev !== undefined) {
    if (value == null || prev == null) delta = '<span class="kpi-delta flat">no comparison</span>';
    else if (prev === 0) delta = value === 0 ? '<span class="kpi-delta flat">no change</span>' : '<span class="kpi-delta flat">new vs previous</span>';
    else {
      const pct = ((value - prev) / Math.abs(prev)) * 100;
      const dir = Math.abs(pct) < 0.5 ? 'flat' : pct > 0 ? 'up' : 'down';
      const good = dir === 'flat' || better === 'neutral' ? 'flat' : (dir === 'up') === (better === 'up') ? 'good' : 'bad';
      const arrow = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '■';
      delta = `<span class="kpi-delta ${good}" title="Previous period: ${esc(Viz.fmtNum(prev))}${esc(suffix)}"><span aria-hidden="true">${arrow}</span> ${Math.abs(pct).toFixed(Math.abs(pct) < 10 ? 1 : 0)}% <span class="muted">vs prev.</span></span>`;
    }
  }
  const tag = goto ? 'a' : 'div';
  const shown = display != null ? display : value == null ? '—' : Viz.fmtNum(value) + suffix;
  return `<${tag} class="kpi ${tone}${goto ? ' is-link' : ''}"${goto ? ` href="${esc(goto)}" data-goto="${esc(goto)}"` : ''}${hint ? ` title="${esc(hint)}"` : ''}>
    <div class="kpi-top"><span class="kpi-label">${esc(label)}</span><span class="kpi-icon">${svg(ICONS[icon] || ICONS.activity, 17)}</span></div>
    <div class="kpi-n">${esc(shown)}</div>
    <div class="kpi-foot">${delta}${spark && spark.length > 1 ? `<span class="kpi-spark">${sparkline(spark, { w: 90, h: 26, cls: 'spark spark-kpi' })}</span>` : ''}</div>
  </${tag}>`;
}

// ---- Card with table view / CSV / expand ------------------------------------
function vizCard({ id, title, sub, icon, span }) {
  const wide = dash.expanded[id] || span === 2;
  return `<section class="panel viz-card${wide ? ' span-2' : ''}" data-card="${id}">
    <div class="panel-head">
      <div class="viz-head"><h3>${svg(ICONS[icon] || ICONS.chart, 16)} ${esc(title)}</h3>${sub ? `<p>${esc(sub)}</p>` : ''}</div>
      <div class="viz-actions">
        <button type="button" class="act-btn${dash.table[id] ? ' is-on' : ''}" data-viz-table="${id}" title="${dash.table[id] ? 'Show chart' : 'Show as table'}" aria-pressed="${!!dash.table[id]}" aria-label="Toggle table view">${svg(dash.table[id] ? ICONS.chart : ICONS.grid, 16)}</button>
        <button type="button" class="act-btn" data-viz-csv="${id}" title="Download this data (CSV)" aria-label="Download ${esc(title)} as CSV">${svg(ICONS.download, 16)}</button>
        ${span === 2 ? '' : `<button type="button" class="act-btn hide-sm" data-viz-expand="${id}" title="${wide ? 'Collapse' : 'Expand'}" aria-label="${wide ? 'Collapse' : 'Expand'} chart">${svg(wide ? '<polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/>' : '<polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>', 16)}</button>`}
      </div>
    </div>
    <div class="viz-body" id="viz-${id}"></div>
  </section>`;
}

function periodLabels(d) {
  const g = d.granularity;
  const parse = (k) => { const [y, mo, dd] = k.split('-').map(Number); return new Date(y, mo - 1, dd || 1); };
  const short = d.trend.map((t) => {
    const dt = parse(t.key);
    return g === 'month' ? dt.toLocaleDateString([], { month: 'short', year: '2-digit' }) : dt.toLocaleDateString([], { day: 'numeric', month: 'short' });
  });
  const long = d.trend.map((t) => {
    const dt = parse(t.key);
    if (g === 'month') return dt.toLocaleDateString([], { month: 'long', year: 'numeric' });
    if (g === 'week') return 'Week of ' + dt.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
    return dt.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  });
  return { short, long };
}
// Drill into one time bucket.
function drillPeriod(d, i) {
  const key = d.trend[i].key;
  const [y, mo, dd] = key.split('-').map(Number);
  let from, to;
  if (d.granularity === 'day') { from = to = key; }
  else if (d.granularity === 'week') { from = localISO(new Date(y, mo - 1, dd)); to = localISO(new Date(y, mo - 1, dd + 6)); }
  else { from = localISO(new Date(y, mo - 1, 1)); to = localISO(new Date(y, mo, 0)); }
  if (from < d.filters.from) from = d.filters.from;
  if (to > d.filters.to) to = d.filters.to;
  setDashFilter({ preset: 'custom', from, to }, from === to ? from : `${from} → ${to}`);
}

// Every visual: how to draw it, its table twin, and its CSV name.
function dashVisuals(d) {
  const labels = periodLabels(d);
  const role = state.user.role;
  const bothDepts = ME_ENABLED && !dash.f.department && d.options.departments.length > 1;
  const pct = (v) => (v == null ? '—' : `${v}%`);
  const hrs = (v) => (v == null ? '—' : fmtMins(v * 60));
  const cats = d.categories;
  const showDeptInCat = !dash.f.department && new Set(cats.filter((c) => !c.other).map((c) => c.department)).size > 1;
  const V = [];

  V.push({
    id: 'trend', title: 'Ticket volume', sub: `Created vs resolved per ${d.granularity} · click a point to drill in`, icon: 'trendingUp', span: 2,
    draw: (el) => Viz.line(el, {
      labels: labels.short, tipLabels: labels.long, height: 250, aria: 'Tickets created and resolved over time',
      series: [{ name: 'Created', values: d.trend.map((t) => t.created) }, { name: 'Resolved', values: d.trend.map((t) => t.resolved) }],
      onSelect: (i) => drillPeriod(d, i),
    }),
    columns: [{ header: 'Period', key: (r) => r.label }, { header: 'Created', key: 'created', num: true }, { header: 'Resolved', key: 'resolved', num: true }, { header: 'Open backlog at end', key: 'backlog', num: true }],
    rows: d.trend.map((t, i) => ({ ...t, label: labels.long[i] })),
  });
  V.push({
    id: 'stage', title: 'Where tickets are now', sub: 'Current stage of tickets created in the period', icon: 'activity',
    draw: (el) => Viz.donut(el, {
      items: d.stages.map((s) => ({ key: s.key, label: s.key, value: s.value, color: cssVar(STAGE_VAR[s.key]) })),
      centerLabel: 'tickets', aria: 'Tickets by stage',
      onSelect: (it) => setDashFilter({ stage: it.key }, `Stage ${it.key}`),
    }),
    columns: [{ header: 'Stage', key: 'key' }, { header: 'Tickets', key: 'value', num: true }],
    rows: d.stages,
  });
  V.push({
    id: 'backlog', title: 'Open backlog over time', sub: `Tickets still open at the end of each ${d.granularity}`, icon: 'inbox',
    draw: (el) => Viz.line(el, {
      labels: labels.short, tipLabels: labels.long, height: 210, area: true, aria: 'Open backlog over time',
      series: [{ name: 'Open backlog', values: d.trend.map((t) => t.backlog) }],
      onSelect: (i) => drillPeriod(d, i),
    }),
    columns: [{ header: 'Period', key: (r) => r.label }, { header: 'Open at end', key: 'backlog', num: true }],
    rows: d.trend.map((t, i) => ({ ...t, label: labels.long[i] })),
  });
  if (bothDepts) {
    V.push({
      id: 'dept', title: 'IT vs Mechanical', sub: `Tickets created per ${d.granularity} · click a column to drill in`, icon: 'grid',
      draw: (el) => Viz.columns(el, {
        labels: labels.short, tipLabels: labels.long, height: 210, aria: 'Tickets created by department',
        series: [{ name: 'IT', values: d.trend.map((t) => t.IT) }, { name: 'ME (Mechanical)', values: d.trend.map((t) => t.ME) }],
        onSelect: (i) => drillPeriod(d, i), tipFoot: 'Click to drill into this period',
      }),
      columns: [{ header: 'Period', key: (r) => r.label }, { header: 'IT', key: 'IT', num: true }, { header: 'ME', key: 'ME', num: true }],
      rows: d.trend.map((t, i) => ({ ...t, label: labels.long[i] })),
    });
  }
  V.push({
    id: 'category', title: 'Top categories', sub: 'Tickets created · click a bar to filter', icon: 'tag',
    draw: (el) => Viz.bars(el, {
      aria: 'Tickets by category',
      items: cats.map((c) => ({ ...c, label: c.other ? c.label : showDeptInCat ? `${c.label} · ${c.department}` : c.label, selectable: !c.other })),
      onSelect: (it) => setDashFilter({ category: it.category, department: it.department || dash.f.department }, `Category ${it.category}`),
    }),
    columns: [{ header: 'Department', key: (r) => r.department || '' }, { header: 'Category', key: (r) => r.label }, { header: 'Tickets', key: 'value', num: true }],
    rows: cats,
  });
  V.push({
    id: 'outlet', title: 'Top outlets', sub: 'Tickets created · click a bar to filter', icon: 'mapPin',
    draw: (el) => Viz.bars(el, {
      aria: 'Tickets by outlet', labelWidth: 110,
      items: d.outlets.map((o) => ({ ...o, label: o.label || o.key, selectable: !o.other })),
      onSelect: (it) => setDashFilter({ outlet: it.key }, `Outlet ${it.key}`),
    }),
    columns: [{ header: 'Outlet', key: (r) => r.label || r.key }, { header: 'Tickets', key: 'value', num: true }],
    rows: d.outlets,
  });
  if (role !== 'Requestor') {
    const techs = d.technicians.slice(0, 12);
    V.push({
      id: 'tech', title: 'Technician workload & results', sub: 'Primary technician on tickets created in the period · click to filter', icon: 'users',
      draw: (el) => Viz.bars(el, {
        aria: 'Tickets per technician', labelWidth: 140,
        series: [{ name: 'Resolved' }, { name: 'Still open' }, { name: 'Cancelled', color: cssVar('--slate') }],
        items: techs.map((t) => ({
          key: t.key, label: t.label, values: [t.resolved, t.open, t.cancelled],
          note: `${t.sla_breached} SLA breach${t.sla_breached === 1 ? '' : 'es'} · avg resolution ${hrs(t.avg_resolution_hours)}`,
        })),
        onSelect: (it) => setDashFilter({ technician: it.key }, `Technician ${it.label}`),
      }),
      columns: [
        { header: 'Technician', key: 'label' }, { header: 'Assigned', key: 'assigned', num: true },
        { header: 'Resolved', key: 'resolved', num: true }, { header: 'Still open', key: 'open', num: true },
        { header: 'Cancelled', key: 'cancelled', num: true }, { header: 'SLA breached', key: 'sla_breached', num: true },
        { header: 'Resolution rate %', key: (r) => (r.assigned ? Math.round((r.resolved / r.assigned) * 1000) / 10 : null), num: true },
        { header: 'Avg resolution (h)', key: 'avg_resolution_hours', num: true },
      ],
      rows: d.technicians,
    });
  }
  if (canSeeSla()) V.push({
    id: 'sla', title: 'SLA by urgency', sub: 'Tickets resolved in the period · click to filter', icon: 'timer',
    draw: (el) => Viz.bars(el, {
      aria: 'SLA achievement by urgency', percent: true, labelWidth: 120,
      series: [{ name: 'Met target', color: cssVar('--viz-good') }, { name: 'Breached', color: cssVar('--viz-bad') }],
      items: d.sla_by_urgency.map((s) => ({ key: s.key, label: `${s.key} · ${fmtMins(s.target_minutes)}`, tipLabel: `${s.key} (target ${fmtMins(s.target_minutes)})`, values: [s.met, s.breached], pct: s.pct })),
      onSelect: (it) => setDashFilter({ urgency: it.key }, `Urgency ${it.key}`),
    }),
    columns: [
      { header: 'Urgency', key: 'key' }, { header: 'Target', key: (r) => fmtMins(r.target_minutes) },
      { header: 'Met', key: 'met', num: true }, { header: 'Breached', key: 'breached', num: true }, { header: 'Achievement', key: (r) => pct(r.pct) },
    ],
    rows: d.sla_by_urgency,
  });
  V.push({
    id: 'restime', title: 'Time to resolve', sub: 'Distribution for tickets resolved in the period', icon: 'clock',
    draw: (el) => Viz.columns(el, {
      labels: d.resolution_distribution.map((r) => r.label), height: 210, aria: 'Resolution time distribution',
      series: [{ name: 'Tickets', values: d.resolution_distribution.map((r) => r.value) }],
    }),
    columns: [{ header: 'Time to resolve', key: 'label' }, { header: 'Tickets', key: 'value', num: true }],
    rows: d.resolution_distribution,
  });
  V.push({
    id: 'aging', title: 'Backlog age', sub: 'How long open tickets have been waiting (now)', icon: 'alertTriangle',
    draw: (el) => Viz.bars(el, {
      aria: 'Open tickets by age', labelWidth: 90, valueName: 'Open tickets',
      items: d.aging.map((a) => ({ key: a.key, label: a.label, value: a.value })),
    }),
    columns: [{ header: 'Age', key: 'label' }, { header: 'Open tickets', key: 'value', num: true }],
    rows: d.aging,
  });
  V.push({
    id: 'heat', title: 'When issues are reported', sub: 'Tickets created by weekday and hour. Plan staffing around the dark cells', icon: 'calendarClock', span: 2,
    draw: (el) => Viz.heatmap(el, { rows: d.heatmap.rows, cols: d.heatmap.cols, values: d.heatmap.values, colSuffix: ':00', aria: 'Tickets by weekday and hour' }),
    columns: [{ header: 'Weekday', key: 'day' }, ...d.heatmap.cols.map((h, i) => ({ header: `${h}:00`, key: (r) => r.values[i], num: true }))],
    rows: d.heatmap.rows.map((day, i) => ({ day, values: d.heatmap.values[i] })),
  });
  const splitRows = [
    ...d.brands.map((b) => ({ dim: 'Brand', key: b.key, label: b.label || b.key, value: b.value, other: b.other })),
    ...d.regions.map((r) => ({ dim: 'Region', key: r.key, label: r.key, value: r.value })),
    ...d.sources.map((s) => ({ dim: 'Source', key: s.key, label: s.label, value: s.value })),
    ...d.urgencies.map((u) => ({ dim: 'Urgency', key: u.key, label: u.key, value: u.value })),
  ];
  V.push({
    id: 'split', title: 'Brand, region, source & urgency', sub: 'Tickets created · click a bar to filter', icon: 'filter',
    draw: (el) => {
      const groups = [
        ['Brand', 'brand', d.brands.map((b) => ({ ...b, label: b.label || b.key, selectable: !b.other }))],
        ['Region', 'region', d.regions.map((r) => ({ ...r, label: r.key }))],
        ['Source', 'source', d.sources.map((s) => ({ ...s }))],
        ['Urgency', 'urgency', d.urgencies.map((u) => ({ ...u, label: u.key }))],
      ];
      for (const [name, dim, items] of groups) {
        const h = document.createElement('h4');
        h.className = 'sub-title';
        h.textContent = name;
        const host = document.createElement('div');
        el.append(h, host);
        Viz.bars(host, { items, labelWidth: 120, rowHeight: 26, aria: `Tickets by ${name.toLowerCase()}`, onSelect: (it) => setDashFilter({ [dim]: it.key }, `${name} ${it.label}`) });
      }
    },
    columns: [{ header: 'Dimension', key: 'dim' }, { header: 'Value', key: 'label' }, { header: 'Tickets', key: 'value', num: true }],
    rows: splitRows,
  });
  return V;
}

async function renderDashboard({ silent = false } = {}) {
  const role = state.user.role;
  if (!silent) {
    readDashUrl();
    view().innerHTML = `
      <div class="page-head page-head-row">
        <div><h2>${role === 'Requestor' ? 'My ticket insights' : 'Operations analytics'}</h2>
          <p id="d-updated">Loading…</p></div>
        <div class="page-actions">
          <button class="btn-outline btn-sm" id="d-refresh" aria-label="Refresh data">${svg(ICONS.refresh, 15)}<span class="hide-sm">Refresh</span></button>
          <div class="menu-wrap">
            <button class="btn-primary btn-sm" id="d-export" aria-haspopup="menu" aria-expanded="false">${svg(ICONS.download, 15)} Export <span aria-hidden="true">▾</span></button>
            <div class="menu" id="d-export-menu" role="menu" hidden>
              <button type="button" role="menuitem" data-export="xlsx">${svg(ICONS.grid, 16)}<span><b>Excel workbook (.xlsx)</b><small>Summary, every visual and all ticket rows, one sheet each</small></span></button>
              <button type="button" role="menuitem" data-export="csv">${svg(ICONS.ticket, 16)}<span><b>CSV ticket rows</b><small>Every ticket created in the period${canSeeSla() ? ', with SLA fields' : ''}</small></span></button>
              <button type="button" role="menuitem" data-export="link">${svg(ICONS.link, 16)}<span><b>Copy link to this view</b><small>Keeps the period and filters</small></span></button>
            </div>
          </div>
        </div>
      </div>
      <button type="button" class="btn-outline btn-block bi-filter-toggle" id="bf-toggle" aria-expanded="false" aria-controls="bi-filters">${svg(ICONS.filter, 15)} Filters <span id="bf-count"></span></button>
      <div class="bi-filters" id="bi-filters"></div>
      <div class="bi-chips" id="bi-chips"></div>
      <div id="d-body" class="d-body"><div class="kpi-grid">${Array(6).fill('<div class="kpi skeleton-kpi"></div>').join('')}</div></div>`;
    $('#d-refresh').addEventListener('click', () => loadDashboard());
    const exp = $('#d-export'), menu = $('#d-export-menu');
    const closeMenu = () => { menu.hidden = true; exp.setAttribute('aria-expanded', 'false'); };
    exp.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.hidden = !menu.hidden;
      exp.setAttribute('aria-expanded', String(!menu.hidden));
      if (!menu.hidden) $('button', menu).focus();
    });
    document.addEventListener('click', (e) => { if (!menu.hidden && !menu.contains(e.target)) closeMenu(); });
    menu.addEventListener('keydown', (e) => {
      const items = $$('button', menu);
      const i = items.indexOf(document.activeElement);
      if (e.key === 'Escape') { closeMenu(); exp.focus(); }
      if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
    });
    $$('[data-export]', menu).forEach((b) => b.addEventListener('click', () => { closeMenu(); exportDashboard(b.dataset.export); }));
    $('#bf-toggle').addEventListener('click', () => {
      const box = $('#bi-filters');
      const open = !box.classList.contains('is-open');
      box.classList.toggle('is-open', open);
      $('#bf-toggle').setAttribute('aria-expanded', String(open));
    });
    startAutoRefresh(() => { if (state.route.name === 'dashboard') loadDashboard({ quiet: true }); }, 120000);
  }
  return loadDashboard({ quiet: silent });
}

function drawFilterBar(d) {
  const box = $('#bi-filters'); if (!box) return;
  const o = d.options;
  const f = dash.f;
  const role = state.user.role;
  const opt = (v, l, cur) => `<option value="${esc(v)}" ${String(cur || '') === String(v) ? 'selected' : ''}>${esc(l)}</option>`;
  const dims = [
    ['department', o.departments.map((v) => [v, v === 'ME' ? 'ME (Mechanical)' : 'IT']), ME_ENABLED && (o.departments.length > 1 || f.department)],
    ['region', o.regions.map((v) => [v, v]), o.regions.length > 1 || f.region],
    ['brand', o.brands.map((v) => [v, v]), o.brands.length > 1 || f.brand],
    ['outlet', o.outlets.map((v) => [v, v]), true],
    ['category', [...new Map(o.categories.filter((c) => !f.department || c.department === f.department).map((c) => [c.value, c.value])).entries()], true],
    ['urgency', URGENCIES.slice().reverse().map((v) => [v, v]), true],
    ['technician', [['none', 'Unassigned'], ...o.technicians.map((t) => [String(t.id), t.name])], role !== 'Requestor'],
    ['stage', STAGES.map((v) => [v, v]), true],
    ['source', Object.entries(SOURCE_LABEL), role !== 'Requestor'],
  ];
  const [from, to] = f.preset === 'custom' ? [f.from, f.to] : presetRange(f.preset);
  box.innerHTML = `
    <div class="bi-filter bi-period">
      <label for="bf-preset">Period</label>
      <select id="bf-preset">${DASH_PRESETS.map(([k, l]) => opt(k, l, f.preset)).join('')}</select>
      <div class="bi-range">
        <input type="date" id="bf-from" value="${esc(from)}" max="${esc(localISO(new Date()))}" aria-label="From date">
        <span aria-hidden="true">→</span>
        <input type="date" id="bf-to" value="${esc(to)}" max="${esc(localISO(new Date()))}" aria-label="To date">
      </div>
    </div>
    ${dims.filter(([, , show]) => show).map(([k, list]) => `
      <div class="bi-filter${f[k] ? ' is-set' : ''}">
        <label for="bf-${k}">${esc(DIM_LABEL[k])}</label>
        <select id="bf-${k}" data-dim="${k}">${opt('', 'All', f[k])}${list.map(([v, l]) => opt(v, l, f[k])).join('')}</select>
      </div>`).join('')}
    <div class="bi-filter bi-filter-end"><button type="button" class="btn-ghost btn-sm" id="bf-reset" ${activeDims().length || f.preset !== '30d' ? '' : 'disabled'}>Reset</button></div>`;
  $('#bf-preset').addEventListener('change', (e) => {
    const k = e.target.value;
    if (k === 'custom') {
      const [a, b] = presetRange(f.preset === 'custom' ? '30d' : f.preset);
      Object.assign(f, { preset: 'custom', from: f.from || a, to: f.to || b });
      writeDashUrl();
      $('#bf-from').focus();
      return;
    }
    setDashFilter({ preset: k, from: '', to: '' });
  });
  const onRange = () => {
    const a = $('#bf-from').value, b = $('#bf-to').value;
    if (!a || !b) return;
    if (a > b) { toast('The start date must be before the end date', 'error'); return; }
    setDashFilter({ preset: 'custom', from: a, to: b });
  };
  $('#bf-from').addEventListener('change', onRange);
  $('#bf-to').addEventListener('change', onRange);
  $$('[data-dim]', box).forEach((s) => s.addEventListener('change', () => {
    const patch = { [s.dataset.dim]: s.value };
    if (s.dataset.dim === 'department' && f.category) patch.category = '';
    setDashFilter(patch);
  }));
  $('#bf-reset').addEventListener('click', () => {
    const clear = Object.fromEntries(DIM_KEYS.map((k) => [k, '']));
    setDashFilter({ ...clear, preset: '30d', from: '', to: '' }, 'reset');
  });
  // Chips = the active slice, removable one by one.
  const chips = $('#bi-chips');
  const act = activeDims();
  const periodTxt = f.preset === 'custom' ? `${d.filters.from} → ${d.filters.to}` : (DASH_PRESETS.find(([k]) => k === f.preset) || [])[1];
  chips.innerHTML = `<span class="bi-period-chip">${svg(ICONS.calendar, 14)} ${esc(periodTxt)} <span class="muted">· ${d.filters.spanDays} day${d.filters.spanDays === 1 ? '' : 's'} · by ${esc(d.granularity)}</span></span>`
    + act.map((k) => `<button type="button" class="filter-pill" data-unset="${k}" aria-label="Remove ${esc(DIM_LABEL[k])} filter">${esc(DIM_LABEL[k])}: <b>${esc(dimValueLabel(k, f[k]))}</b>${svg(ICONS.x, 12)}</button>`).join('');
  $$('[data-unset]', chips).forEach((b) => b.addEventListener('click', () => setDashFilter({ [b.dataset.unset]: '' })));
  $('#bf-count').textContent = act.length ? `(${act.length})` : '';
}

async function loadDashboard({ quiet = false } = {}) {
  const seq = ++dash.seq;
  const body = $('#d-body');
  if (!body) return;
  body.classList.add('is-loading'); // keep the previous frame, dimmed
  const btn = $('#d-refresh'); if (btn) btn.classList.add('is-spinning');
  let d;
  try {
    d = await apiJSON('/api/analytics?' + dashQuery().toString());
  } catch (e) {
    if (seq !== dash.seq) return;
    body.classList.remove('is-loading');
    if (btn) btn.classList.remove('is-spinning');
    if (quiet && dash.data) return toast(e.message, 'error');
    body.innerHTML = errBox(e, () => loadDashboard());
    return;
  }
  if (seq !== dash.seq || state.route.name !== 'dashboard' || !$('#d-body')) return;
  dash.data = d;
  body.classList.remove('is-loading');
  if (btn) btn.classList.remove('is-spinning');
  $('#d-updated').textContent = `${d.filters.from} → ${d.filters.to} · updated ${new Date(d.generated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  drawFilterBar(d);
  drawDashboardBody(d);
}

function drawDashboardBody(d) {
  const body = $('#d-body');
  const K = d.kpis;
  const role = state.user.role;
  const created = d.trend.map((t) => t.created);
  const resolved = d.trend.map((t) => t.resolved);
  const backlog = d.trend.map((t) => t.backlog);
  const ticketsLink = (extra) => q({ ...(dash.f.department ? { department: dash.f.department } : {}), ...extra });
  const mine = d.mine ? `<section class="dash-sec"><h3 class="sec-title">${svg(ICONS.userPlus, 16)} Assigned to me</h3><div class="kpi-grid">
      ${kpiTile({ label: 'My open jobs', value: d.mine.open, icon: 'ticket', tone: 'tone-primary', goto: q({ scope: 'mine', open: '1' }) })}
      ${kpiTile({ label: 'In progress', value: d.mine.on_progress, icon: 'activity', tone: 'tone-progress', goto: q({ scope: 'mine', status: 'On Progress' }) })}
      ${kpiTile({ label: 'Waiting', value: d.mine.waiting, icon: 'package', tone: 'tone-warn', goto: q({ scope: 'mine', open: '1' }) })}
      ${kpiTile({ label: 'Overdue (SLA)', value: d.mine.overdue, icon: 'alertTriangle', tone: d.mine.overdue ? 'tone-danger' : 'tone-ok', goto: q({ scope: 'mine', open: '1', sla: 'Breached' }) })}
      ${kpiTile({ label: 'I resolved this period', value: d.mine.resolved_in_range, icon: 'checkCircle2', tone: 'tone-ok' })}
    </div></section>` : '';
  const kpis = `<section class="dash-sec"><div class="kpi-grid kpi-grid-bi">
      ${kpiTile({ label: 'Tickets created', value: K.created, prev: K.prev.created, better: 'neutral', spark: created, icon: 'zap', tone: 'tone-info' })}
      ${kpiTile({ label: 'Tickets resolved', value: K.resolved, prev: K.prev.resolved, better: 'up', spark: resolved, icon: 'checkCircle2', tone: 'tone-ok' })}
      ${!canSeeSla() ? '' : kpiTile({ label: 'SLA achievement', value: K.sla_pct, prev: K.prev.sla_pct, suffix: '%', better: 'up', icon: 'timer', tone: K.sla_pct == null ? '' : K.sla_pct >= 90 ? 'tone-ok' : K.sla_pct >= 75 ? 'tone-warn' : 'tone-danger', hint: `${K.sla_met} met · ${K.sla_breached} breached (tickets resolved in the period)` })}
      ${kpiTile({ label: 'Mean time to resolve', value: K.mttr_hours, display: K.mttr_hours == null ? '—' : fmtMins(K.mttr_hours * 60), prev: K.prev.mttr_hours, better: 'down', icon: 'clock', tone: 'tone-primary', hint: K.median_resolution_hours != null ? `Median ${fmtMins(K.median_resolution_hours * 60)}` : '' })}
      ${kpiTile({ label: 'Avg first response', value: K.first_response_mins, display: K.first_response_mins == null ? '—' : fmtMins(K.first_response_mins), prev: K.prev.first_response_mins, better: 'down', icon: 'messageCircle', tone: 'tone-primary' })}
      ${kpiTile({ label: 'Resolution rate', value: K.resolution_rate, prev: K.prev.resolution_rate, suffix: '%', better: 'up', icon: 'trendingUp', tone: 'tone-ok', hint: 'Share of tickets created in the period that are already resolved' })}
    </div>
    <h3 class="sec-title">${svg(ICONS.inbox, 16)} Right now</h3>
    <div class="kpi-grid kpi-grid-fit">
      ${kpiTile({ label: 'Open backlog', value: K.backlog_now, spark: backlog, icon: 'inbox', tone: 'tone-primary', goto: ticketsLink({ open: '1' }) })}
      ${!canSeeSla() ? '' : kpiTile({ label: 'Overdue (SLA)', value: K.overdue_now, icon: 'alertTriangle', tone: K.overdue_now ? 'tone-danger' : 'tone-ok', goto: ticketsLink({ open: '1', sla: 'Breached' }), hint: `${K.at_risk_now} more at risk` })}
      ${role === 'Requestor' ? '' : kpiTile({ label: 'Unassigned', value: K.unassigned_now, icon: 'userX', tone: K.unassigned_now ? 'tone-warn' : '', goto: ticketsLink({ assigned: 'no' }) })}
      ${kpiTile({ label: 'Critical open', value: K.critical_now, icon: 'zap', tone: K.critical_now ? 'tone-danger' : '', goto: ticketsLink({ urgency: 'Critical', open: '1' }) })}
      ${kpiTile({ label: 'Waiting on parts / vendor', value: K.waiting_now, icon: 'package', tone: K.waiting_now ? 'tone-warn' : '', goto: ticketsLink({ open: '1' }) })}
    </div></section>`;

  const visuals = dashVisuals(d);
  body.innerHTML = `${mine}${kpis}
    <div class="dash-grid bi-grid">${visuals.map(vizCard).join('')}</div>
    <section class="panel mt" id="d-detail"></section>`;
  // Draw (or tabulate) each visual.
  for (const v of visuals) {
    const host = $('#viz-' + v.id);
    if (dash.table[v.id]) Viz.table(host, v.columns, v.rows);
    else v.draw(host);
  }
  $$('[data-viz-table]', body).forEach((b) => b.addEventListener('click', () => {
    dash.table[b.dataset.vizTable] = !dash.table[b.dataset.vizTable];
    drawDashboardBody(dash.data);
  }));
  $$('[data-viz-expand]', body).forEach((b) => b.addEventListener('click', () => {
    dash.expanded[b.dataset.vizExpand] = !dash.expanded[b.dataset.vizExpand];
    drawDashboardBody(dash.data);
  }));
  $$('[data-viz-csv]', body).forEach((b) => b.addEventListener('click', () => {
    const v = visuals.find((x) => x.id === b.dataset.vizCsv);
    const name = `itme_${v.id}_${d.filters.from}_to_${d.filters.to}.csv`;
    Viz.downloadBlob(Viz.toCsv(v.columns, v.rows), name, 'text/csv;charset=utf-8');
    toast(`${v.title} downloaded`, 'success');
  }));
  drawDetailTable(d);
  wireCardLinks('#d-body');
}

function drawDetailTable(d) {
  const box = $('#d-detail'); if (!box) return;
  const size = window.matchMedia('(max-width: 760px)').matches ? 6 : 15;
  const rows = d.detail;
  const pages = Math.max(1, Math.ceil(rows.length / size));
  dash.detailPage = Math.min(Math.max(1, dash.detailPage), pages);
  const page = rows.slice((dash.detailPage - 1) * size, dash.detailPage * size);
  box.innerHTML = `
    <div class="panel-head"><div class="viz-head"><h3>${svg(ICONS.ticket, 16)} Tickets in this view</h3>
      <p>${d.detail_total} created in the period${d.detail_total > rows.length ? ` · newest ${rows.length} shown, export for all` : ''}</p></div>
      <div class="viz-actions"><button type="button" class="btn-outline btn-sm" id="d-detail-csv">${svg(ICONS.download, 15)} CSV</button></div></div>
    <div class="table-wrap"><table class="data table-cards">
      <thead><tr><th>Ticket</th><th>Subject</th><th>Status</th><th>Urgency</th>${canSeeSla() ? '<th>SLA</th>' : ''}<th>Outlet</th><th>Category</th><th>Technician</th><th>Created</th></tr></thead>
      <tbody>${page.length ? page.map((t) => `<tr class="dt-row" data-id="${t.id}" tabindex="0">
        <td data-label="Ticket"><a class="dt-num" href="/tickets/${t.id}" data-nav>${esc(t.ticket_number || '#' + t.id)}</a> <span class="dt-subject-sm">${esc(t.title || '')}</span></td>
        <td data-label="Subject"><span class="dt-subject">${esc(t.title || '')}</span></td>
        <td data-label="Status">${badge(t.status)}</td>
        <td data-label="Urgency">${urgBadge(t.urgency)}</td>
        ${canSeeSla() ? `<td data-label="SLA">${slaChip(t, { quiet: false }) || '—'}</td>` : ''}
        <td data-label="Outlet">${esc(t.outlet_code || '—')}</td>
        <td data-label="Category">${deptTag(t.department)} ${esc(t.category || '—')}</td>
        <td data-label="Technician">${t.assignee_name ? esc(t.assignee_name) : '<span class="unassigned">Unassigned</span>'}</td>
        <td data-label="Created"><span class="dt-nowrap" title="${esc(fmtFull(t.created_at))}">${esc(fmtDate(t.created_at))}</span></td>
      </tr>`).join('') : '<tr><td colspan="9" class="empty-cell">No tickets created in this view</td></tr>'}</tbody>
    </table></div>
    ${pages > 1 ? `<div class="dt-foot"><span class="muted">Page ${dash.detailPage} of ${pages}</span><div class="dt-foot-right">
      <button class="btn-outline dt-pg" id="dd-prev" ${dash.detailPage <= 1 ? 'disabled' : ''} aria-label="Previous page">‹</button>
      <button class="btn-outline dt-pg" id="dd-next" ${dash.detailPage >= pages ? 'disabled' : ''} aria-label="Next page">›</button></div></div>` : ''}`;
  $$('.dt-row', box).forEach((tr) => {
    const go = (e) => { if (e.target.closest('a')) return; navigate('/tickets/' + tr.dataset.id); };
    tr.addEventListener('click', go);
    tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(e); });
  });
  const prev = $('#dd-prev'), next = $('#dd-next');
  if (prev) prev.addEventListener('click', () => { dash.detailPage--; drawDetailTable(d); });
  if (next) next.addEventListener('click', () => { dash.detailPage++; drawDetailTable(d); });
  $('#d-detail-csv').addEventListener('click', () => exportDashboard('csv'));
}

async function exportDashboard(kind) {
  if (kind === 'link') {
    return copyText(location.origin + location.pathname + location.search, 'Link to this view copied');
  }
  const btn = $('#d-export');
  if (btn) btn.disabled = true;
  const [from, to] = dash.data ? [dash.data.filters.from, dash.data.filters.to] : ['', ''];
  try {
    toast(kind === 'xlsx' ? 'Building Excel workbook…' : 'Preparing CSV…', 'info');
    await downloadCsv('/api/analytics/export?' + dashQuery({ format: kind }).toString(), `itme_analytics_${from}_to_${to}.${kind}`);
    toast(kind === 'xlsx' ? 'Excel workbook downloaded' : 'CSV downloaded', 'success');
  } catch (e) { toast(e.message || 'Export failed', 'error'); }
  finally { if (btn) btn.disabled = false; }
}

// Make [data-goto] elements navigate in-app (keyboard too), keeping
// middle/ctrl-click on real links as "open in new tab".
function wireCardLinks(sel) {
  $$(sel + ' [data-goto]').forEach((el) => {
    if (el._wired) return; el._wired = true;
    const go = (e) => {
      if (e && (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1)) return;
      if (e) e.preventDefault();
      navigate(el.dataset.goto);
    };
    el.addEventListener('click', go);
    if (el.tagName !== 'A' && el.tagName !== 'BUTTON')
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  });
}
function statCard(n, l, accent) { return `<div class="stat ${accent ? 'accent-' + accent : ''}"><span class="n">${esc(n)}</span><span class="l">${esc(l)}</span></div>`; }
// Count-up animation for numeric values (preserves any suffix like "h")
function animateCounters(root, skip = false) {
  if (skip || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  $$('.stat .n, [data-count]', root).forEach((el) => {
    const m = /^(\d+)(.*)$/.exec(el.textContent.trim());
    if (!m) return;
    const target = Number(m[1]), suffix = m[2] || '';
    if (target <= 0 || target > 100000) return;
    const dur = 550, t0 = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - t0) / dur);
      el.textContent = Math.round(target * (1 - Math.pow(1 - p, 3))) + suffix;
      if (p < 1) requestAnimationFrame(step);
    };
    el.textContent = '0' + suffix;
    requestAnimationFrame(step);
  });
}

// ==========================================================================
// View: Tickets list
// ==========================================================================
// scope = technician PIC filter · sort = '' (newest) | created_asc | updated | urgency
// `sla` is applied client-side on the loaded rows (SLA is computed, not stored).
const EMPTY_FILTERS = { status: '', status_group: '', urgency: '', department: '', region: '', outlet: '', category: '', search: '', scope: '', sort: '', assigned: '', open: '', sla: '' };
const listFilters = { ...EMPTY_FILTERS };
const TECH_SCOPES = [
  { value: '', label: 'My PIC outlets' },
  { value: 'mine', label: 'Assigned to me' },
  { value: 'unassigned_pic', label: 'Unassigned in my PIC' },
  { value: 'all', label: 'All allowed tickets' },
];
const FILTER_LABELS = {
  status: 'Status', status_group: 'Stage', urgency: 'Urgency', department: 'Dept', region: 'Region',
  outlet: 'Outlet', category: 'Category', search: 'Search', assigned: 'Assignee', open: 'Open only', sla: 'SLA',
};
// Cards on phones, table on wider screens — unless the user picked one.
let ticketView = store.get('ticketView') || (window.matchMedia('(min-width: 900px)').matches ? 'table' : 'cards');
let ticketRows = [];
let ticketLoadSeq = 0;
// col = null → keep the server order chosen by the toolbar's sort select.
const dtState = { col: null, dir: 'asc', page: 1, pageSize: 25 };

const QUICK_FILTERS = [
  { key: 'open', label: 'All open', apply: { open: '1' } },
  { key: 'new', label: 'New', apply: { status_group: 'New' } },
  { key: 'unassigned', label: 'Unassigned', apply: { assigned: 'no' }, hide: (r) => r === 'Requestor' },
  { key: 'progress', label: 'In progress', apply: { status: 'On Progress' } },
  { key: 'overdue', label: 'Overdue', apply: { open: '1', sla: 'Breached' }, tone: 'danger', hide: (r) => r === 'Requestor' },
  { key: 'critical', label: 'Critical', apply: { urgency: 'Critical', open: '1' }, tone: 'danger' },
  { key: 'done', label: 'Resolved / closed', apply: { status_group: 'Closed' } },
];
function quickActive(qf) {
  const want = { ...EMPTY_FILTERS, search: listFilters.search, scope: listFilters.scope, sort: listFilters.sort, ...qf.apply };
  return Object.keys(EMPTY_FILTERS).every((k) => (listFilters[k] || '') === (want[k] || ''));
}

async function renderTickets() {
  // Deep-link filters (e.g. dashboard card → /tickets?status=New): start from a
  // clean set, apply the query keys, then tidy the URL.
  const sp = new URLSearchParams(location.search);
  if ([...sp.keys()].length) {
    Object.assign(listFilters, EMPTY_FILTERS);
    for (const k of Object.keys(EMPTY_FILTERS)) if (sp.has(k)) listFilters[k] = sp.get(k).slice(0, 120);
    history.replaceState(null, '', '/tickets');
  }
  const role = state.user.role;
  const showDept = ME_ENABLED && ['SuperAdmin', 'Leader'].includes(role);
  const showRegion = ['SuperAdmin', 'AdminIT', 'AdminME', 'Leader'].includes(role);
  const isTech = role.startsWith('Technician');
  view().innerHTML = `
    <div class="page-head page-head-row">
      <div><h2>${navLabel('tickets')}</h2><p>${ticketsSubtitle()}</p></div>
      <div class="page-actions">
        <button class="btn-outline btn-sm" id="t-refresh" aria-label="Refresh list">${svg(ICONS.refresh, 15)}<span class="hide-sm">Refresh</span></button>
        <button class="btn-outline btn-sm" id="t-export" title="Download the filtered tickets as CSV">${svg(ICONS.download, 15)}<span class="hide-sm">Export CSV</span></button>
      </div>
    </div>
    <div class="quick-filters" id="t-quick" role="toolbar" aria-label="Quick filters">
      ${QUICK_FILTERS.filter((f) => !(f.hide && f.hide(role))).map((f) => `<button type="button" class="qf ${f.tone ? 'qf-' + f.tone : ''} ${quickActive(f) ? 'active' : ''}" data-qf="${f.key}" aria-pressed="${quickActive(f)}">${esc(f.label)}</button>`).join('')}
    </div>
    <div class="toolbar">
      <div class="search">${svg(ICONS.search, 16)}<input id="f-search" type="search" placeholder="Search tickets…" title="Search number, subject, outlet or person (shortcut: /)" value="${esc(listFilters.search)}" aria-label="Search tickets" enterkeyhint="search"></div>
      ${isTech ? `<select id="f-scope" aria-label="Scope">${TECH_SCOPES.map((s) => `<option value="${s.value}" ${listFilters.scope === s.value ? 'selected' : ''}>${s.label}</option>`).join('')}</select>` : ''}
      <select id="f-status" aria-label="Status">${statusFilterOptionsHTML()}</select>
      <select id="f-urg" aria-label="Urgency"><option value="">All urgency</option>${URGENCIES.map((s) => `<option ${listFilters.urgency === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
      ${showDept ? `<select id="f-dept" aria-label="Department"><option value="">All depts</option><option ${listFilters.department === 'IT' ? 'selected' : ''}>IT</option><option ${listFilters.department === 'ME' ? 'selected' : ''}>ME</option></select>` : ''}
      ${showRegion ? `<select id="f-region" aria-label="Region"><option value="">All regions</option>${REGIONS.map((r) => `<option ${listFilters.region === r ? 'selected' : ''}>${r}</option>`).join('')}</select>` : ''}
      <select id="f-sort" aria-label="Sort">
        <option value="" ${!listFilters.sort ? 'selected' : ''}>Newest first</option>
        <option value="updated" ${listFilters.sort === 'updated' ? 'selected' : ''}>Recently updated</option>
        <option value="urgency" ${listFilters.sort === 'urgency' ? 'selected' : ''}>Most urgent</option>
        <option value="created_asc" ${listFilters.sort === 'created_asc' ? 'selected' : ''}>Oldest first</option>
      </select>
      <div class="seg" id="t-viewseg" role="group" aria-label="List view">
        <button class="seg-b ${ticketView === 'cards' ? 'active' : ''}" data-view="cards" aria-pressed="${ticketView === 'cards'}">Cards</button>
        <button class="seg-b ${ticketView === 'table' ? 'active' : ''}" data-view="table" aria-pressed="${ticketView === 'table'}">Table</button>
      </div>
    </div>
    <div class="list-meta" id="t-meta" aria-live="polite"></div>
    <div id="ticket-list" class="ticket-list">${skeletonRows()}</div>`;

  const reload = () => { syncFilterControls(); loadTicketList(); };
  $('#f-search').addEventListener('input', debounce((e) => { listFilters.search = e.target.value.trim(); reload(); }, 300));
  $('#f-status').addEventListener('change', (e) => {
    const v = e.target.value;
    listFilters.status_group = v.startsWith('g:') ? v.slice(2) : '';
    listFilters.status = v.startsWith('g:') ? '' : v;
    reload();
  });
  $('#f-urg').addEventListener('change', (e) => { listFilters.urgency = e.target.value; reload(); });
  if (isTech) $('#f-scope').addEventListener('change', (e) => { listFilters.scope = e.target.value; reload(); });
  if (showDept) $('#f-dept').addEventListener('change', (e) => { listFilters.department = e.target.value; reload(); });
  if (showRegion) $('#f-region').addEventListener('change', (e) => { listFilters.region = e.target.value; reload(); });
  $('#f-sort').addEventListener('change', (e) => { listFilters.sort = e.target.value; reload(); });
  $$('#t-quick .qf').forEach((b) => b.addEventListener('click', () => {
    const qf = QUICK_FILTERS.find((f) => f.key === b.dataset.qf);
    const keep = { search: listFilters.search, scope: listFilters.scope, sort: listFilters.sort };
    Object.assign(listFilters, EMPTY_FILTERS, keep, quickActive(qf) ? {} : qf.apply);
    reload();
  }));
  $$('#t-viewseg .seg-b').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.view === ticketView) return;
    ticketView = b.dataset.view;
    store.set('ticketView', ticketView);
    $$('#t-viewseg .seg-b').forEach((x) => { x.classList.toggle('active', x === b); x.setAttribute('aria-pressed', String(x === b)); });
    drawTicketList();
  }));
  $('#t-export').addEventListener('click', exportTicketList);
  $('#t-refresh').addEventListener('click', () => loadTicketList({ keepPage: true }));
  startAutoRefresh(() => { if (state.route.name === 'tickets' && !document.querySelector('.modal-overlay')) loadTicketList({ keepPage: true, silent: true }); }, 90000);
  loadTicketList();
}
// Re-sync the toolbar + chips after a filter change made elsewhere.
function syncFilterControls() {
  const set = (id, v) => { const el = $(id); if (el) el.value = v; };
  set('#f-status', listFilters.status_group ? 'g:' + listFilters.status_group : listFilters.status);
  set('#f-urg', listFilters.urgency);
  set('#f-dept', listFilters.department);
  set('#f-region', listFilters.region);
  set('#f-scope', listFilters.scope);
  set('#f-sort', listFilters.sort);
  $$('#t-quick .qf').forEach((b) => {
    const on = quickActive(QUICK_FILTERS.find((f) => f.key === b.dataset.qf));
    b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on));
  });
}
async function exportTicketList() {
  const btn = $('#t-export');
  const qs = ticketQueryString();
  btn.disabled = true;
  try {
    await downloadCsv('/api/tickets/export' + (qs ? '?' + qs : ''), `tickets_${new Date().toISOString().slice(0, 10)}.csv`);
    toast('Export downloaded', 'success');
  } catch (e) { toast(e.message || 'Export failed', 'error'); }
  finally { btn.disabled = false; }
}
// Status filter: grouped stages (dashboard drill-downs) + every exact status.
function statusFilterOptionsHTML() {
  const groups = ['New', 'Open', 'On Progress', 'Closed', 'Cancelled'];
  const groupOpts = groups.map((g) =>
    `<option value="g:${esc(g)}" ${listFilters.status_group === g ? 'selected' : ''}>${esc(g)} (stage)</option>`).join('');
  const exactOpts = STATUSES.map((s) =>
    `<option value="${esc(s)}" ${listFilters.status === s ? 'selected' : ''}>${esc(s)}</option>`).join('');
  return `<option value="" ${!listFilters.status && !listFilters.status_group ? 'selected' : ''}>All statuses</option>`
    + `<optgroup label="Stage">${groupOpts}</optgroup>`
    + `<optgroup label="Exact status">${exactOpts}</optgroup>`;
}
function ticketsSubtitle() {
  const r = state.user.role;
  if (r === 'Requestor') return 'Issues you have reported and their progress';
  if (r.startsWith('Technician')) return 'Jobs in your PIC outlets and the ones you are on';
  if (r === 'Leader') return 'View-only across your scope';
  return 'Triage, assign and follow every ticket in your scope';
}
function ticketQueryString() {
  const qs = new URLSearchParams();
  Object.entries(listFilters).forEach(([k, v]) => { if (v && k !== 'sla') qs.append(k, v); });
  return qs.toString();
}
function visibleTicketRows() {
  return listFilters.sla ? ticketRows.filter((t) => t.sla_status === listFilters.sla) : ticketRows;
}
async function loadTicketList({ keepPage = false, silent = false } = {}) {
  const seq = ++ticketLoadSeq;
  const box = $('#ticket-list');
  if (box && !silent) box.classList.add('is-loading');
  try {
    const rows = await api.tickets(ticketQueryString());
    if (seq !== ticketLoadSeq) return; // a newer request superseded this one
    ticketRows = rows;
    if (!keepPage) { dtState.col = null; dtState.page = 1; }
    drawTicketList();
  } catch (e) {
    if (seq !== ticketLoadSeq) return;
    if (silent) return;
    const b = $('#ticket-list'); if (b) b.innerHTML = errBox(e, () => loadTicketList());
  } finally {
    const b = $('#ticket-list'); if (b && seq === ticketLoadSeq) b.classList.remove('is-loading');
  }
}
function drawListMeta(count) {
  const meta = $('#t-meta'); if (!meta) return;
  const pills = Object.entries(listFilters)
    .filter(([k, v]) => v && k !== 'sort' && k !== 'scope')
    .map(([k, v]) => {
      const shown = k === 'open' ? 'yes' : k === 'assigned' ? 'unassigned' : v;
      return `<button type="button" class="filter-pill" data-clear="${k}" aria-label="Remove filter ${esc(FILTER_LABELS[k])}">${esc(FILTER_LABELS[k] || k)}: <b>${esc(shown)}</b>${svg(ICONS.x, 12)}</button>`;
    });
  meta.innerHTML = `<span class="count"><b>${count}</b> ticket${count === 1 ? '' : 's'}</span>${pills.join('')}${pills.length > 1 ? '<button type="button" class="link-btn" data-clear="*">Clear all</button>' : ''}`;
  $$('[data-clear]', meta).forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.clear === '*') Object.assign(listFilters, EMPTY_FILTERS, { scope: listFilters.scope, sort: listFilters.sort });
    else listFilters[b.dataset.clear] = '';
    if (b.dataset.clear === 'search' || b.dataset.clear === '*') { const s = $('#f-search'); if (s) s.value = ''; }
    syncFilterControls();
    loadTicketList();
  }));
}
// Renders whatever is in `ticketRows` in the active view.
function drawTicketList() {
  const box = $('#ticket-list'); if (!box) return;
  const rows = visibleTicketRows();
  drawListMeta(rows.length);
  box.classList.toggle('ticket-list', ticketView === 'cards');
  if (!rows.length) {
    const filtered = Object.entries(listFilters).some(([k, v]) => v && k !== 'sort' && k !== 'scope');
    box.innerHTML = emptyBox('ticket', filtered ? 'No tickets match these filters' : 'No tickets yet',
      filtered ? 'Try removing a filter above.' : CAN_CREATE.includes(state.user.role) ? 'Use “Report issue” to create the first one.' : 'Nothing in your scope right now.');
    return;
  }
  if (ticketView === 'table') return drawTicketTable(box);
  const size = 60;
  const shown = rows.slice(0, dtState.page * size);
  box.innerHTML = shown.map(ticketRow).join('') + (rows.length > shown.length
    ? `<button type="button" class="btn-outline btn-block" id="t-more">Show ${Math.min(size, rows.length - shown.length)} more (${rows.length - shown.length} left)</button>` : '');
  const more = $('#t-more', box);
  if (more) more.addEventListener('click', () => { dtState.page++; drawTicketList(); });
  $$('.ticket-row', box).forEach((el) => {
    el.addEventListener('click', (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
      e.preventDefault();
      navigate('/tickets/' + el.dataset.id);
    });
  });
}
function assigneeText(t) {
  return t.assignee_name && t.assignee_name !== 'Unassigned' ? esc(t.assignee_name) : '<span class="unassigned">Unassigned</span>';
}
function ticketRow(t) {
  const sched = t.status === 'On Scheduled' && t.scheduled_at ? `<span class="meta-i sched-chip">${svg(ICONS.calendarClock, 13)}${fmtDate(t.scheduled_at)}</span>` : '';
  const pub = t.source === 'public_quick_report' ? '<span class="src-chip">Public</span>' : '';
  return `<a class="ticket-row urg-${esc(t.urgency)}" href="/tickets/${t.id}" data-id="${t.id}">
    <div class="tr-main">
      <div class="tr-top"><span class="tnum">${esc(t.ticket_number || '#' + t.id)}</span>${deptTag(t.department)}${pub}<span class="aging ${agingClass(t)}" title="${esc(fmtFull(t.created_at))}">${timeAgo(t.created_at)}</span></div>
      <div class="ttitle">${esc(t.title)}</div>
      <div class="tmeta">
        <span class="meta-i">${svg(ICONS.mapPin, 13)}${esc(t.outlet_code || '—')}${t.region ? ' · ' + esc(t.region) : ''}</span>
        <span class="meta-i">${svg(ICONS.tag, 13)}${esc(t.category || '—')}</span>
        <span class="meta-i">${svg(ICONS.users, 13)}${assigneeText(t)}</span>
        ${sched}
      </div>
    </div>
    <div class="tbadges">${badge(t.status)}${urgBadge(t.urgency)}${slaChip(t)}</div>
  </a>`;
}

// --------------------------------------------------------------------------
// Datatable view — same rows as the cards, laid out as a sortable, paginated
// table. `cell` renders the HTML; `val` is what the column sorts on.
// --------------------------------------------------------------------------
const URG_RANK = { Critical: 1, High: 2, Medium: 3, Low: 4 };
const SLA_RANK = { 'Breached': 1, 'At Risk': 2, 'Not Started': 3, 'On Track': 4, 'Met': 5, 'N/A': 6 };
const tsOf = (s) => { const d = parseTs(s); return d ? d.getTime() : 0; };
const DT_COLUMNS = [
  { key: 'ticket_number', label: 'Ticket', val: (t) => t.ticket_number || '#' + t.id, cell: (t) => `<a class="dt-num" href="/tickets/${t.id}" tabindex="-1">${esc(t.ticket_number || '#' + t.id)}</a>${t.source === 'public_quick_report' ? '<span class="src-chip">Public</span>' : ''}` },
  { key: 'title', label: 'Subject', val: (t) => t.title || '', cell: (t) => `<span class="dt-subject" title="${esc(t.title || '')}">${esc(t.title || '')}</span>` },
  { key: 'status', label: 'Status', val: (t) => STATUSES.indexOf(t.status), cell: (t) => badge(t.status) },
  { key: 'urgency', label: 'Urgency', val: (t) => URG_RANK[t.urgency] || 9, cell: (t) => urgBadge(t.urgency) },
  { key: 'sla', label: 'SLA', val: (t) => SLA_RANK[t.sla_status] || 9, cell: (t) => slaChip(t, { quiet: false }) || '<span class="muted">—</span>' },
  { key: 'department', label: 'Dept', val: (t) => t.department || '', cell: (t) => deptTag(t.department) },
  { key: 'category', label: 'Category', val: (t) => t.category || '', cell: (t) => esc(t.category || '—') },
  { key: 'outlet_code', label: 'Outlet', val: (t) => t.outlet_code || '', cell: (t) => `<span class="dt-nowrap">${esc(t.outlet_code || '—')}</span>${t.region ? `<div class="muted small">${esc(t.region)}</div>` : ''}` },
  { key: 'assignee_name', label: 'Assignee', val: (t) => (t.assignee_name === 'Unassigned' ? '' : t.assignee_name || ''), cell: assigneeText },
  { key: 'customer_name', label: 'Requestor', val: (t) => t.customer_name || '', cell: (t) => esc(t.customer_name || '—') },
  { key: 'created_at', label: 'Created', val: (t) => tsOf(t.created_at), cell: (t) => `<span class="dt-nowrap" title="${esc(fmtFull(t.created_at))}">${esc(fmtDate(t.created_at))}</span><div class="aging small ${agingClass(t)}">${esc(timeAgo(t.created_at))}</div>` },
];
const dtColumns = () => DT_COLUMNS.filter((c) => c.key !== 'sla' || canSeeSla());
const DT_PAGE_SIZES = [25, 50, 100, 0]; // 0 = all

function dtSortedRows() {
  const rows = visibleTicketRows();
  if (!dtState.col) return rows;
  const col = DT_COLUMNS.find((c) => c.key === dtState.col);
  if (!col) return rows;
  const sign = dtState.dir === 'desc' ? -1 : 1;
  return rows.slice().sort((a, b) => {
    let x = col.val(a), y = col.val(b);
    if (typeof x !== 'number' || typeof y !== 'number') {
      x = String(x).toLowerCase(); y = String(y).toLowerCase();
      if (x !== y && (!x || !y)) return !x ? 1 : -1; // blanks always last
    }
    return x < y ? -sign : x > y ? sign : 0;
  });
}

function drawTicketTable(box) {
  const rows = dtSortedRows();
  const size = dtState.pageSize || rows.length || 1;
  const pages = Math.max(1, Math.ceil(rows.length / size));
  dtState.page = Math.min(Math.max(1, dtState.page), pages);
  const from = (dtState.page - 1) * size;
  const page = rows.slice(from, from + size);
  const arrow = (c) => (dtState.col === c.key ? (dtState.dir === 'asc' ? '▲' : '▼') : '▲');
  box.innerHTML = `
    <div class="panel dt-panel">
      <div class="table-wrap">
        <table class="data dt">
          <thead><tr>${dtColumns().map((c) => `
            <th class="dt-sortable ${dtState.col === c.key ? 'dt-on' : ''}" data-col="${c.key}" tabindex="0" role="columnheader"
                aria-sort="${dtState.col === c.key ? (dtState.dir === 'asc' ? 'ascending' : 'descending') : 'none'}">
              ${esc(c.label)}<span class="dt-arrow" aria-hidden="true">${arrow(c)}</span>
            </th>`).join('')}</tr></thead>
          <tbody>${page.map((t) => `
            <tr class="dt-row urg-${esc(t.urgency)}" data-id="${t.id}" tabindex="0">
              ${dtColumns().map((c) => `<td data-label="${esc(c.label)}">${c.cell(t)}</td>`).join('')}
            </tr>`).join('')}</tbody>
        </table>
      </div>
      <div class="dt-foot">
        <span class="muted">Showing ${rows.length ? from + 1 : 0}–${from + page.length} of ${rows.length}</span>
        <div class="dt-foot-right">
          <label class="dt-size">Rows
            <select id="dt-size">${DT_PAGE_SIZES.map((n) => `<option value="${n}" ${dtState.pageSize === n ? 'selected' : ''}>${n || 'All'}</option>`).join('')}</select>
          </label>
          <button class="btn-outline dt-pg" id="dt-prev" ${dtState.page <= 1 ? 'disabled' : ''} aria-label="Previous page">‹</button>
          <span class="muted dt-nowrap">${dtState.page} / ${pages}</span>
          <button class="btn-outline dt-pg" id="dt-next" ${dtState.page >= pages ? 'disabled' : ''} aria-label="Next page">›</button>
        </div>
      </div>
    </div>`;
  $$('.dt-sortable', box).forEach((th) => {
    const sort = () => {
      if (dtState.col === th.dataset.col) dtState.dir = dtState.dir === 'asc' ? 'desc' : 'asc';
      else { dtState.col = th.dataset.col; dtState.dir = 'asc'; }
      dtState.page = 1;
      drawTicketTable(box);
    };
    th.addEventListener('click', sort);
    th.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sort(); } });
  });
  $$('.dt-row', box).forEach((tr) => {
    const go = (e) => {
      if (e && (e.metaKey || e.ctrlKey)) { window.open('/tickets/' + tr.dataset.id, '_blank'); return; }
      if (e) e.preventDefault();
      navigate('/tickets/' + tr.dataset.id);
    };
    tr.addEventListener('click', go);
    tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(e); });
  });
  $('#dt-size').addEventListener('change', (e) => { dtState.pageSize = Number(e.target.value); dtState.page = 1; drawTicketTable(box); });
  $('#dt-prev').addEventListener('click', () => { dtState.page--; drawTicketTable(box); box.scrollIntoView({ block: 'start', behavior: 'smooth' }); });
  $('#dt-next').addEventListener('click', () => { dtState.page++; drawTicketTable(box); box.scrollIntoView({ block: 'start', behavior: 'smooth' }); });
}

// ==========================================================================
// View: Ticket detail
// ==========================================================================
let detailUploader = null;
const draftKey = (id) => 'draft:' + id;
const sessionStore = {
  get(k) { try { return sessionStorage.getItem(k) || ''; } catch (_) { return ''; } },
  set(k, v) { try { if (v) sessionStorage.setItem(k, v); else sessionStorage.removeItem(k); } catch (_) {} },
};

function fact(label, value, icon) {
  return `<div class="fact"><dt>${icon ? svg(ICONS[icon], 14) : ''}${esc(label)}</dt><dd>${value}</dd></div>`;
}

function slaPanelHTML(t) {
  if (!t.sla_status || !canSeeSla()) return '';
  const due = parseTs(t.sla_deadline_at);
  const done = ['Resolved', 'Closed'].includes(t.status);
  let line;
  if (t.sla_status === 'N/A') line = 'Not tracked for cancelled tickets.';
  else if (t.sla_status === 'Met') line = `Resolved within the ${fmtMins(t.sla_target_minutes)} target.`;
  else if (t.sla_status === 'Breached') line = done
    ? `Resolved ${fmtMins(t.breach_minutes)} after the deadline.`
    : `Overdue by ${fmtMins(t.breach_minutes)}. Needs attention.`;
  else if (due) line = `${fmtMins((due - Date.now()) / 60000)} left of the ${fmtMins(t.sla_target_minutes)} target.`;
  const pct = due && t.sla_target_minutes
    ? Math.max(0, Math.min(100, Math.round(((t.aging_minutes || 0) / t.sla_target_minutes) * 100)))
    : 0;
  return `<div class="panel side-panel sla-panel ${SLA_CLS[t.sla_status] || ''}">
    <div class="panel-head"><h3>${svg(ICONS.timer, 16)} SLA</h3>${slaChip(t, { quiet: false })}</div>
    <div class="card-pad">
      <div class="sla-meter" role="img" aria-label="${pct}% of target time used"><span style="width:${pct}%"></span></div>
      <p class="sla-line">${esc(line || '')}</p>
      ${due ? `<p class="hint">Due ${esc(fmtFull(t.sla_deadline_at))} · ${esc(t.urgency)} target</p>` : ''}
    </div></div>`;
}

async function renderTicketDetail(id) {
  const isRefresh = !!$('#ticket-detail[data-id="' + CSS.escape(String(id)) + '"]');
  if (!isRefresh) view().innerHTML = `<div class="detail-skeleton"><div class="skeleton" style="height:90px"></div><div class="skeleton" style="height:240px"></div></div>`;
  let data;
  try { data = await api.ticket(id); }
  catch (e) {
    view().innerHTML = `<div class="page-head"><a href="/tickets" data-nav class="back-link">${svg('<polyline points="15 18 9 12 15 6"/>', 16)} Back to tickets</a></div>${errBox(e, () => renderTicketDetail(id))}`;
    wireNavLinks(); return;
  }
  if (state.route.name !== 'ticket' || String(state.route.id) !== String(id)) return; // navigated away
  const { ticket: t, comments, activity, attachments, primaryTechnician, collaborators } = data;
  const u = state.user;
  const isDeptAdmin = u.role === 'SuperAdmin' || (u.role === 'AdminIT' && t.department === 'IT') || (u.role === 'AdminME' && t.department === 'ME');
  const team = { primary: primaryTechnician, collaborators: collaborators || [] };
  // Edit rights follow the backend: a technician on the team (Primary or
  // Collaborator) in the same department may act on the ticket.
  const isAssignedTech = !!myTeamRole(t, team) && techDeptMatches(t);
  const canReply = u.role !== 'Leader';
  setActiveNav('tickets', t.ticket_number || 'Ticket');

  const attByComment = {};
  for (const a of attachments) {
    if (a.comment_id != null) (attByComment[a.comment_id] = attByComment[a.comment_id] || []).push(a);
  }
  const loose = attachments.filter((a) => a.comment_id == null);
  const events = [
    ...comments.map((c) => ({ t: c.created_at, kind: c.is_system ? 'sys' : 'msg', author: c.author_name, role: c.author_role, text: c.message, atts: attByComment[c.id] || [], mine: c.author_user_id === u.id })),
    ...activity.filter((a) => a.action !== 'comment.added').map((a) => ({ t: a.created_at, kind: 'sys', action: a.action, author: a.actor_name, role: a.actor_role, text: actionText(a) })),
  ].sort((a, b) => tsOf(a.t) - tsOf(b.t));

  const reporter = t.public_reporter_name || t.customer_name || '—';
  const contact = t.public_reporter_contact || t.contact_number;
  const scrollY = window.scrollY;
  view().innerHTML = `
    <div id="ticket-detail" data-id="${t.id}">
    <div class="detail-nav">
      <a href="/tickets" data-nav class="back-link">${svg('<polyline points="15 18 9 12 15 6"/>', 16)} Tickets</a>
      <div class="page-actions">
        <button class="btn-ghost btn-sm" id="td-copy" title="Copy link to this ticket">${svg(ICONS.link, 15)}<span class="hide-sm">Copy link</span></button>
        <button class="btn-ghost btn-sm" id="td-refresh" aria-label="Refresh ticket">${svg(ICONS.refresh, 15)}</button>
      </div>
    </div>
    <header class="detail-top urg-${esc(t.urgency)}">
      <div class="detail-id"><span class="tnum">${esc(t.ticket_number || '#' + t.id)}</span>${deptTag(t.department)}${t.source === 'public_quick_report' ? '<span class="src-chip">Public report</span>' : ''}</div>
      <h2>${esc(t.title)}</h2>
      <div class="detail-headline">${badge(t.status)}${urgBadge(t.urgency)}${slaChip(t)}<span class="muted">·</span><span class="muted">${esc(t.outlet_name || t.outlet_code || '—')}</span><span class="muted">·</span><span class="aging ${agingClass(t)}" title="${esc(fmtFull(t.created_at))}">opened ${timeAgo(t.created_at)}</span></div>
    </header>
    <div class="detail-grid">
      <div class="detail-main">
        <section class="panel">
          <div class="panel-head"><h3>${svg(ICONS.ticket, 16)} Details</h3></div>
          <div class="card-pad">
            <div class="desc">${esc(t.description || '')}</div>
            <dl class="facts">
              ${fact('Outlet', `${esc(t.outlet_name || t.outlet_code || '—')}${t.outlet_name && t.outlet_code && t.outlet_name !== t.outlet_code ? ` <span class="muted">${esc(t.outlet_code)}</span>` : ''}${t.brand_code ? ` <span class="muted">· ${esc(t.brand_code)}</span>` : ''}`, 'mapPin')}
              ${fact('Category', `${deptTag(t.department)} ${esc(t.category || '—')}`, 'tag')}
              ${fact(t.source === 'public_quick_report' ? 'Reporter' : 'Requester', esc(reporter), 'users')}
              ${fact('Contact', contact ? `<a href="tel:${esc(String(contact).replace(/[^\d+]/g, ''))}">${esc(contact)}</a>` : '—', 'phone')}
              ${t.region ? fact('Region', esc(t.region), 'grid') : ''}
              ${fact('Created', esc(fmtFull(t.created_at)), 'clock')}
              ${t.scheduled_at ? fact('Scheduled', `${esc(fmtFull(t.scheduled_at))}${t.scheduled_end ? ` → ${esc(fmtFull(t.scheduled_end))}` : ''}`, 'calendarClock') : ''}
              ${t.started_at ? fact('Work started', esc(fmtFull(t.started_at)), 'activity') : ''}
              ${t.resolved_at ? fact('Resolved', esc(fmtFull(t.resolved_at)), 'checkCircle') : ''}
              ${t.closed_at ? fact('Closed', esc(fmtFull(t.closed_at)), 'checkCircle2') : ''}
              ${t.location_detail ? fact('Location', esc(t.location_detail), 'mapPin') : ''}
              ${t.device_equipment ? fact('Device', esc(t.device_equipment), 'monitor') : ''}
              ${t.business_impact ? fact('Impact', esc(t.business_impact), 'alertTriangle') : ''}
              ${t.preferred_visit_time ? fact('Visit time', esc(t.preferred_visit_time), 'calendar') : ''}
              ${t.sparepart_note ? fact('Sparepart', esc(t.sparepart_note), 'package') : ''}
              ${t.vendor_note ? fact('Vendor', esc(t.vendor_note), 'truck') : ''}
              ${t.expected_part_date ? fact('Expected', esc(fmtFull(t.expected_part_date)), 'calendar') : ''}
              ${t.estimated_cost != null ? fact('Est. cost', esc(Number(t.estimated_cost).toLocaleString()), 'tag') : ''}
              ${t.cancel_reason && t.status === 'Cancelled' ? fact('Cancelled because', esc(t.cancel_reason), 'slash') : ''}
            </dl>
            ${t.resolution_note ? `<div class="resolution">${svg(ICONS.checkCircle, 16)}<div><b>Resolution</b><p>${esc(t.resolution_note)}</p></div></div>` : ''}
          </div>
        </section>
        ${loose.length ? `<section class="panel"><div class="panel-head"><h3>${svg(ICONS.image, 16)} Evidence</h3><span class="muted small">${loose.length} file${loose.length === 1 ? '' : 's'}</span></div><div class="card-pad"><div class="tl-atts">${loose.map(attCard).join('')}</div></div></section>` : ''}
        <section class="panel">
          <div class="panel-head"><h3>${svg(ICONS.messageCircle, 16)} Activity & replies</h3><span class="muted small">${comments.length} repl${comments.length === 1 ? 'y' : 'ies'}</span></div>
          <div class="card-pad">
            <ol class="timeline">${events.length ? events.map(tlItem).join('') : '<li class="muted">No activity yet.</li>'}</ol>
            ${canReply ? replyBoxHTML(t) : '<p class="muted mt">Leaders have view-only access.</p>'}
          </div>
        </section>
      </div>
      <!-- Side pane: status action first, then SLA and the team. On mobile it is
           ordered above the details so a technician never scrolls to act. -->
      <aside id="action-pane" class="detail-side">
        ${actionPaneHTML(t, isDeptAdmin, isAssignedTech)}
        ${slaPanelHTML(t)}
        ${assignedTeamHTML(t, team, isDeptAdmin)}
      </aside>
    </div>
    </div>`;
  if (isRefresh) window.scrollTo(0, scrollY);
  wireNavLinks();
  $('#td-copy').addEventListener('click', () => copyText(`${location.origin}/tickets/${t.id}`, 'Ticket link copied'));
  $('#td-refresh').addEventListener('click', () => renderTicketDetail(t.id));
  if (canReply) wireReply(t);
  wireActionPane(t, isDeptAdmin);
  wireAssignedTeam(t);
}

/* --------------------------------------------------------------------------
   Who am I on this ticket?  "primary" | "collaborator" | null
   Mirrors assignment.service.teamRoleOf, including the legacy fallback on
   tickets.assigned_technician_id. Display only — the server re-checks.
   -------------------------------------------------------------------------- */
function myTeamRole(t, team) {
  const u = state.user;
  if (!u || !u.role.startsWith('Technician')) return null;
  if (team.primary && team.primary.technician_id === u.id) return 'primary';
  if ((team.collaborators || []).some((c) => c.technician_id === u.id)) return 'collaborator';
  if (t.assigned_technician_id === u.id) return 'primary';
  return null;
}
function techDeptMatches(t) {
  const u = state.user;
  if (!u || !u.role.startsWith('Technician')) return false;
  return t.department === (u.role === 'TechnicianIT' ? 'IT' : 'ME');
}

/* --------------------------------------------------------------------------
   Assigned Team — who owns the ticket and who is helping.
   Primary Technician / PIC is deliberately the visually stronger row;
   Collaborators are listed underneath. Both have explicit empty states.
   -------------------------------------------------------------------------- */
// A technician may invite a Collaborator when they are on the team themselves
// (Primary or Collaborator), the ticket is in their department, and it is still
// open. The backend re-checks all of this — this is only for showing the button.
function canInviteCollaborator(t, team) {
  if (!techDeptMatches(t)) return false;
  if (TERMINAL_STATUSES.includes(t.status)) return false;
  return !!myTeamRole(t, team);
}
function assignedTeamHTML(t, team, isDeptAdmin) {
  const primaryName = (team.primary && team.primary.technician_name)
    || (t.assignee_name && t.assignee_name !== 'Unassigned' ? t.assignee_name : null);
  const meRole = myTeamRole(t, team);
  const youTag = (isYou) => isYou ? '<span class="team-you">you</span>' : '';
  const primaryRow = primaryName
    ? `<div class="team-row team-primary">
         <div class="team-avatar">${esc(techInitials(primaryName))}</div>
         <div class="team-id"><div class="team-name">${esc(primaryName)}${youTag(meRole === 'primary')}</div>
           <div class="team-role">Primary Technician / PIC</div></div>
         <span class="badge badge-pic" title="Primary Technician / PIC">${svg(ICONS.star, 12)} PIC</span>
       </div>`
    : `<div class="team-empty">${svg(ICONS.star, 14)} No Primary Technician yet.</div>`;
  const collabs = team.collaborators || [];
  const collabRows = collabs.length
    ? collabs.map((c) => `<div class="team-row team-collab">
         <div class="team-avatar sm">${esc(techInitials(c.technician_name))}</div>
         <div class="team-id"><div class="team-name">${esc(c.technician_name)}${youTag(c.technician_id === state.user.id)}</div>
           <div class="team-role">Collaborator</div></div>
         <span class="badge badge-collab" title="Collaborator">${svg(ICONS.userPlus, 12)}</span>
       </div>`).join('')
    : `<div class="team-empty">${svg(ICONS.userPlus, 14)} No collaborators yet.</div>`;
  // Technicians on the team invite; admins get the full assignment manager.
  // Both live in this card so "who is on this ticket" and "change who is on it"
  // are never in two different places.
  const actions = [];
  if (canInviteCollaborator(t, team))
    actions.push(`<button class="btn-outline btn-block" id="btn-invite-collab">${svg(ICONS.userPlus, 15)} Invite Collaborator</button>`);
  if (isDeptAdmin)
    actions.push(`<button class="btn-outline btn-block" id="btn-manage-assign">${svg(ICONS.users, 15)} Manage Assignment</button>`);
  return `<div class="panel side-panel">
    <div class="panel-head"><h3>${svg(ICONS.users, 16)} Assigned Team</h3>
      <span class="team-count">${collabs.length + (primaryName ? 1 : 0)}</span></div>
    <div class="card" style="border:none">
      ${primaryRow}
      <div class="team-sub">Collaborators</div>
      ${collabRows}
      ${actions.length ? `<div class="team-actions">${actions.join('')}</div>` : ''}
    </div>
  </div>`;
}
function wireAssignedTeam(t) {
  const btn = $('#btn-invite-collab');
  if (btn) btn.addEventListener('click', () => openInviteCollaboratorModal(t, () => renderTicketDetail(t.id)));
  const mng = $('#btn-manage-assign');
  if (mng) mng.addEventListener('click', () => openAssignModal(t, () => renderTicketDetail(t.id)));
}
// Assignment events are logged as complete sentences ("Admin added X as
// Collaborator.") so they read as-is instead of being prefixed with a label.
const SENTENCE_ACTIONS = ['ticket.assigned', 'ticket.collaborator_added', 'ticket.collaborator_invited', 'ticket.assignment_removed'];
function actionText(a) {
  if (!a.detail) return humanAction(a.action);
  if (SENTENCE_ACTIONS.includes(a.action)) return a.detail;
  // Status changes are logged as a sentence ("T TechIT changed status from Open
  // to On Progress."). Older rows hold a bare "Open → On Progress" and still
  // read best with the "Status changed — " prefix.
  if (a.action === 'status.changed' && !a.detail.includes('→')) return a.detail;
  return `${humanAction(a.action)}: ${a.detail}`;
}
function humanAction(a) { return ({ 'ticket.created': 'Ticket created', 'ticket.assigned': 'Assigned', 'ticket.collaborator_added': 'Collaborator added', 'ticket.collaborator_invited': 'Collaborator invited', 'ticket.assignment_removed': 'Assignment removed', 'status.changed': 'Status changed', 'urgency.changed': 'Urgency changed', 'comment.added': 'Comment', 'department.changed': 'Re-routed', 'category.changed': 'Category changed', 'outlet.changed': 'Outlet changed' }[a] || a); }
const TL_ICON = {
  'ticket.created': 'zap', 'status.changed': 'activity', 'ticket.assigned': 'userPlus',
  'ticket.collaborator_added': 'userPlus', 'ticket.collaborator_invited': 'userPlus',
  'ticket.assignment_removed': 'userX', 'urgency.changed': 'alertTriangle',
  'department.changed': 'swap', 'category.changed': 'tag', 'outlet.changed': 'mapPin',
};
function tlItem(e) {
  const atts = (e.atts && e.atts.length) ? `<div class="tl-atts">${e.atts.map(attCard).join('')}</div>` : '';
  const when = `<time class="tl-time" datetime="${esc(e.t)}" title="${esc(fmtFull(e.t))}">${esc(fmtDate(e.t))}</time>`;
  if (e.kind === 'sys') {
    return `<li class="tl-item sys"><span class="tl-ic">${svg(ICONS[TL_ICON[e.action]] || ICONS.activity, 14)}</span>
      <div class="tl-body"><div class="tl-msg">${esc(e.text)}</div><div class="tl-sub">${esc(e.author || 'System')} · ${when}</div>${atts}</div></li>`;
  }
  return `<li class="tl-item msg${e.mine ? ' mine' : ''}"><span class="tl-avatar">${esc(techInitials(e.author))}</span>
    <div class="tl-body"><div class="tl-head"><span class="tl-author">${esc(e.author)}</span><span class="tl-role">${esc(ROLE_LABEL[e.role] || e.role || '')}</span>${when}</div>
    <div class="tl-msg">${e.text === '(attachment)' ? '<span class="muted">Shared attachments</span>' : esc(e.text)}</div>${atts}</div></li>`;
}
function attCard(a) {
  const isImg = (a.mime_type || '').startsWith('image/');
  const phaseTag = a.phase && a.phase !== 'general' ? `<span class="phase-tag phase-${esc(a.phase)}">${esc(a.phase)}</span>` : '';
  if (isImg) return `<a class="att-card att-img" href="${esc(a.file_url)}" target="_blank" rel="noopener" data-preview="${esc(a.file_url)}" data-preview-name="${esc(a.file_name)}" title="${esc(a.file_name)}">${phaseTag}<img class="att-thumb" src="${esc(a.file_url)}" alt="${esc(a.file_name)}" loading="lazy" decoding="async"><span class="an">${esc(a.file_name)}</span></a>`;
  return `<a class="att-card att-file" href="${esc(a.file_url)}" target="_blank" rel="noopener" title="${esc(a.file_name)}">${svg('<polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/>', 18)}${phaseTag}<span class="an">${esc(a.file_name)}</span>${a.file_size ? `<span class="muted small">${fmtBytes(a.file_size)}</span>` : ''}</a>`;
}
function replyBoxHTML(t) {
  const isStaff = state.user.role !== 'Requestor';
  return `<form class="reply-box" id="reply-form" novalidate>
    <label for="reply-msg" class="sr-only">Reply</label>
    <textarea id="reply-msg" maxlength="4000" placeholder="${isStaff ? 'Post an update: what you found, what you did, what is next…' : 'Add information or ask a question…'}">${esc(sessionStore.get(draftKey(t.id)))}</textarea>
    ${uploadZoneHTML('reply-up')}
    <div class="reply-tools">
      ${isStaff ? `<label class="inline-label" for="reply-phase">Photo type</label><select id="reply-phase"><option value="general">General</option><option value="before">Before repair</option><option value="after">After repair</option></select>` : '<input type="hidden" id="reply-phase" value="general">'}
      <span class="hint hide-sm">Ctrl + Enter to send</span>
      <button type="submit" class="btn-primary right" id="reply-send">${svg('<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>', 15)} Send</button>
    </div></form>`;
}
function wireReply(t) {
  detailUploader = new Uploader($('#reply-up'), $('#reply-up-list'));
  const form = $('#reply-form');
  const box = $('#reply-msg');
  const btn = $('#reply-send');
  box.addEventListener('input', debounce(() => sessionStore.set(draftKey(t.id), box.value), 300));
  box.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); form.requestSubmit(); } });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (btn.disabled) return;
    const msg = box.value.trim();
    const ids = detailUploader.ids();
    if (detailUploader.uploading()) { toast('Wait for uploads to finish', 'error'); return; }
    if (!msg && !ids.length) { toast('Write a message or add a photo', 'error'); box.focus(); return; }
    btn.disabled = true;
    const label = btn.innerHTML; btn.textContent = 'Sending…';
    try {
      await api.comment(t.id, { message: msg, attachmentIds: ids, phase: $('#reply-phase').value });
      sessionStore.set(draftKey(t.id), '');
      toast('Reply posted', 'success');
      renderTicketDetail(t.id);
    } catch (err) { toast(err.message, 'error'); btn.disabled = false; btn.innerHTML = label; }
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
/* --------------------------------------------------------------------------
   Why can (or can't) this viewer update the status?
   One function so the button state and the explanation can never disagree.
   Returns { canUpdate, note } — `note` is a short sentence, or '' when the
   control is simply usable and needs no explaining.
   -------------------------------------------------------------------------- */
function statusAccess(t, isDeptAdmin, isAssignedTech) {
  const u = state.user;
  const isTech = u.role.startsWith('Technician');
  if (isDeptAdmin) return { canUpdate: true, note: '' };
  if (TERMINAL_STATUSES.includes(t.status)) {
    return {
      canUpdate: false,
      icon: 'lock',
      note: `This ticket is already ${t.status === 'Closed' ? 'closed' : 'cancelled'}.`
        + (isTech ? ' Only an admin can reopen it.' : ''),
    };
  }
  if (isAssignedTech) return { canUpdate: true, note: '' };
  if (isTech && !techDeptMatches(t)) {
    return { canUpdate: false, icon: 'lock', note: `This is a ${t.department} ticket, outside your department.` };
  }
  if (isTech) {
    return { canUpdate: false, icon: 'lock', note: 'You are not assigned to this ticket.' };
  }
  return { canUpdate: false, icon: 'clock', note: 'You’ll be notified of updates here.' };
}

// The most likely next move(s) from each status — shown as one-tap buttons.
const NEXT_STEPS = {
  'New': [['Open', 'Acknowledge', 'inbox'], ['On Progress', 'Start work', 'activity']],
  'Open': [['On Progress', 'Start work', 'activity'], ['On Scheduled', 'Schedule', 'calendarClock']],
  'Assigned': [['On Progress', 'Start work', 'activity']],
  'On Scheduled': [['On Progress', 'Start work', 'activity']],
  'On Progress': [['Resolved', 'Mark resolved', 'checkCircle'], ['Waiting Sparepart', 'Waiting part', 'package']],
  'Waiting Sparepart': [['On Progress', 'Resume work', 'activity']],
  'Waiting Vendor': [['On Progress', 'Resume work', 'activity']],
  'Pending Outlet Response': [['On Progress', 'Resume work', 'activity']],
  'Escalated': [['On Progress', 'Resume work', 'activity']],
  'Resolved': [['Closed', 'Close ticket', 'checkCircle2']],
};
function actionPaneHTML(t, isDeptAdmin, isAssignedTech) {
  const access = statusAccess(t, isDeptAdmin, isAssignedTech);
  const head = `<div class="panel-head"><h3>${svg(ICONS.activity, 16)} Status</h3></div>`;
  const now = `<div class="status-now">${statusIcon(t.status, 18)}${badge(t.status)}
      ${t.status === 'On Scheduled' && t.scheduled_at ? `<span class="status-when">${svg(ICONS.calendarClock, 13)} ${fmtDate(t.scheduled_at)}</span>` : ''}</div>`;

  // Read-only / blocked: the state plus one short reason, never a dead control.
  if (!access.canUpdate) {
    const selfAssign = canSelfAssign(t)
      ? `<button class="btn-primary btn-block btn-lg mt" id="act-selfassign">${svg(ICONS.userPlus, 16)} Take this job</button>
         <p class="hint center">You become Primary if nobody is, otherwise a Collaborator.</p>`
      : '';
    return `<div class="panel side-panel action-panel">${head}
      <div class="card-pad">${now}
        <p class="status-note">${svg(ICONS[access.icon] || ICONS.clock, 14)} ${esc(access.note)}</p>
        ${selfAssign}
      </div></div>`;
  }

  const options = statusOptionsHTML(t, isDeptAdmin);
  const reachable = new Set([...options.matchAll(/<option[^>]*>([^<]+)<\/option>/g)].map((m) => m[1].replace(/&amp;/g, '&')));
  const steps = (NEXT_STEPS[t.status] || []).filter(([s]) => reachable.has(s) && s !== t.status);
  let html = `<div class="panel side-panel action-panel">${head}<div class="card-pad">${now}
    ${steps.length ? `<div class="next-steps">${steps.map(([s, label, ic], i) => `<button type="button" class="${i === 0 ? 'btn-primary' : 'btn-outline'} btn-block btn-lg" data-next="${esc(s)}">${svg(ICONS[ic], 16)} ${esc(label)}</button>`).join('')}</div>
      <details class="more-status"><summary>Other status…</summary>` : ''}
    <div class="field"><label for="act-status">Change status to</label>
      <select id="act-status">${options}</select></div>`;
  if (isDeptAdmin) {
    html += `<div class="field"><label for="act-urg">Urgency</label><select id="act-urg">${URGENCIES.map((s) => `<option ${s === t.urgency ? 'selected' : ''}>${s}</option>`).join('')}</select></div>`;
  }
  html += `<button class="${steps.length ? 'btn-outline' : 'btn-primary'} btn-block" id="act-apply">${svg(ICONS.checkCircle, 15)} Apply</button>`;
  if (steps.length) html += '</details>';
  if (isDeptAdmin) html += `<button class="btn-ghost btn-block mt" id="act-advanced">${svg(ICONS.swap, 15)} ${ME_ENABLED ? 'Re-route department / category' : 'Change category'}</button>`;
  html += `</div></div>`;
  return html;
}
// Options for the "Change to" control, grouped so the 4-status main flow stays
// obvious while the operational states remain one scroll away:
//   • Admin → main flow + every extended status the ticket can reach.
//   • Tech  → main flow + the operational states they own (TECH_STATUSES).
//             "New" is display-only and "Cancelled" is admin-only, so neither
//             is offered; reopening a Closed/Cancelled ticket is admin-only too.
// Both are filtered by canTransition(), and the ticket's current status is
// always present and preselected, so a ticket sitting in an extended status
// renders correctly instead of falling back to "New".
function statusOptionsHTML(t, isDeptAdmin) {
  const opt = (s) => `<option ${s === t.status ? 'selected' : ''}>${esc(s)}</option>`;
  const reachable = (s) => s === t.status || canTransition(t.status, s);
  const settable = isDeptAdmin ? STATUSES : TECH_STATUSES;
  const allowed = settable.filter(reachable);
  const core = CORE_STATUSES.filter((s) => allowed.includes(s));
  const extended = EXTENDED_STATUSES.filter((s) => allowed.includes(s));
  // Keep the current status visible even when it is not otherwise settable
  // (e.g. a technician looking at an "Assigned" ticket).
  if (!core.includes(t.status) && !extended.includes(t.status)) {
    (CORE_STATUSES.includes(t.status) ? core : extended).unshift(t.status);
  }
  return (core.length ? `<optgroup label="Main flow">${core.map(opt).join('')}</optgroup>` : '')
    + (extended.length ? `<optgroup label="Operational">${extended.map(opt).join('')}</optgroup>` : '');
}
function wireActionPane(t, isDeptAdmin) {
  const selfBtn = $('#act-selfassign');
  if (selfBtn) selfBtn.addEventListener('click', async () => {
    const label = selfBtn.innerHTML;
    selfBtn.disabled = true; selfBtn.textContent = 'Assigning…';
    try {
      const r = await api.assignToMe(t.id);
      toast(r.self_role === 'collaborator' ? 'You joined as Collaborator' : 'You are now the Primary Technician', 'success');
      renderTicketDetail(t.id);
    } catch (e) { toast(e.message, 'error'); selfBtn.disabled = false; selfBtn.innerHTML = label; }
  });
  const apply = $('#act-apply');
  if (!apply) return; // read-only / blocked pane — nothing else to wire
  let busy = false;
  const buttons = () => $$('#action-pane [data-next], #act-apply');
  const run = async (newStatus, btn) => {
    if (busy) return;
    const patch = {};
    const urgEl = $('#act-urg');
    if (isDeptAdmin && urgEl && urgEl.value !== t.urgency) patch.urgency = urgEl.value;
    const extra = await collectStatusExtras(t, newStatus, isDeptAdmin);
    if (extra === null) return; // cancelled
    let newPic = null;
    if (extra.reassign_pic_id !== undefined) {
      const id = extra.reassign_pic_id ? Number(extra.reassign_pic_id) : null;
      if (id && id !== t.assigned_technician_id) newPic = id;
      delete extra.reassign_pic_id;
    }
    Object.assign(patch, extra);
    if (newStatus !== t.status) patch.status = newStatus;
    if (!Object.keys(patch).length && !newPic) { toast('Nothing to change', 'info'); return; }

    busy = true;
    const label = btn.innerHTML;
    buttons().forEach((b) => { b.disabled = true; });
    btn.textContent = 'Saving…';
    try {
      // Status first: a closed ticket must be reopened before its team changes.
      if (Object.keys(patch).length) await api.patchTicket(t.id, patch);
      if (newPic) await api.assign(t.id, { technician_id: newPic, role_type: 'primary' });
      toast(patch.status
        ? `Status → ${patch.status}${newPic ? ' · Primary technician changed' : ''}`
        : newPic ? 'Primary technician changed' : 'Ticket updated', 'success');
      renderTicketDetail(t.id);
    } catch (e) {
      toast(e.message, 'error');
      busy = false;
      buttons().forEach((b) => { b.disabled = false; });
      btn.innerHTML = label;
      if (Object.keys(patch).length && newPic) renderTicketDetail(t.id); // status saved, assign failed
    }
  };
  apply.addEventListener('click', () => run($('#act-status').value, apply));
  $$('#action-pane [data-next]').forEach((b) => b.addEventListener('click', () => run(b.dataset.next, b)));
  const adv = $('#act-advanced'); if (adv) adv.addEventListener('click', () => openRerouteModal(t));
}
/* What each status needs on top of the status itself. Returns the extra patch
   fields, or null when the user backed out of the dialog.
   Hard requirements (resolution note, cancel reason, reopen reason) are enforced
   by the server too. Everything else is optional and must never block the
   update — a technician standing at an outlet should always be able to record
   the real state, then fill in detail later. */
async function collectStatusExtras(t, newStatus, isDeptAdmin = false) {
  if (newStatus === t.status && (newStatus !== 'Open' || !isDeptAdmin)) return {};

  if (newStatus === 'Open' && isDeptAdmin) {
    try {
      const [ticketBundle, techs] = await Promise.all([
        api.ticket(t.id).catch(() => null),
        api.technicians(t.department).catch(() => []),
      ]);
      const primary = ticketBundle ? ticketBundle.primaryTechnician : null;
      const currentPicId = primary ? primary.technician_id : (t.assigned_technician_id || null);
      const currentPicName = primary ? primary.technician_name : (t.assignee_name && t.assignee_name !== 'Unassigned' ? t.assignee_name : null);

      const options = [];
      if (currentPicId) {
        options.push({ value: String(currentPicId), label: `${currentPicName || 'Technician'} (PIC Utama saat ini)` });
      } else {
        options.push({ value: '', label: '-- Pilih PIC Utama --' });
      }
      for (const tech of techs) {
        if (tech.id !== currentPicId && tech.is_active) {
          options.push({ value: String(tech.id), label: `${tech.username} (${tech.workload != null ? tech.workload + ' tiket open' : 'Teknisi'})` });
        }
      }

      const fields = [];
      const isReopen = TERMINAL_STATUSES.includes(t.status);
      if (isReopen) {
        fields.push({
          name: 'reason',
          label: 'Reason for reopening',
          type: 'textarea',
          required: true,
          placeholder: 'Reason for reopening this ticket...',
        });
      }
      fields.push({
        name: 'reassign_pic_id',
        label: 'Primary Technician / PIC Utama',
        type: 'select',
        value: String(currentPicId || ''),
        options,
        hint: 'Opsional: Ubah atau re-assign PIC Utama untuk tiket ini.',
      });

      const modalTitle = isReopen ? 'Reopen Ticket & Manage PIC' : 'Set Status Open & PIC Utama';
      const submitLabel = isReopen ? 'Reopen Ticket' : 'Set Status';
      const v = await formModal(modalTitle, fields, submitLabel);
      return v;
    } catch (e) {
      console.error('Error fetching technicians for Open status modal:', e);
      return {};
    }
  }

  if (newStatus === 'Resolved' || newStatus === 'Closed') {
    if (t.resolution_note && newStatus === 'Closed') return {};
    const v = await formModal(newStatus === 'Resolved' ? 'Mark Resolved' : 'Close ticket',
      [{ name: 'resolution_note', label: 'Resolution note (what was done)', type: 'textarea', required: true, value: t.resolution_note || '' }], newStatus);
    return v;
  }
  if (newStatus === 'Cancelled') {
    return await formModal('Cancel ticket', [{ name: 'cancel_reason', label: 'Reason for cancellation', type: 'textarea', required: true }], 'Cancel ticket');
  }
  // On Scheduled — a planned date/time is offered but optional: not knowing the
  // slot yet is not a reason to keep the ticket in the wrong status.
  if (newStatus === 'On Scheduled') {
    return await formModal('Schedule work', [
      {
        name: 'scheduled_at', label: 'Planned date & time', type: 'datetime-local',
        value: t.scheduled_at ? String(t.scheduled_at).replace(' ', 'T').slice(0, 16) : '',
        hint: 'Optional. You can set the slot later.',
      },
    ], 'Set schedule');
  }
  // Waiting statuses — a note saying what is being waited for. Soft-required:
  // leaving it empty warns once and then lets the update through.
  if (WAITING_STATUSES.includes(newStatus)) {
    const spec = {
      'Waiting Sparepart': { title: 'Waiting for sparepart', field: 'sparepart_note', label: 'Sparepart needed', date: true },
      'Waiting Vendor': { title: 'Waiting for vendor', field: 'vendor_note', label: 'Vendor / detail', date: true },
      'Pending Outlet Response': { title: 'Pending outlet response', field: 'status_note', label: 'What are we waiting for from the outlet?', date: false },
    }[newStatus];
    const fields = [{ name: spec.field, label: spec.label, type: 'text', hint: 'Recommended. It explains the wait in the activity log.' }];
    if (spec.date) fields.push({ name: 'expected_part_date', label: 'Expected date (optional)', type: 'date' });
    const v = await formModal(spec.title, fields, 'Set status');
    if (v === null) return null;
    if (!String(v[spec.field] || '').trim()) {
      const go = await confirmModal('No note added',
        `Set "${newStatus}" without saying what is being waited for? The next person on this ticket will not know why it is parked.`,
        'Set anyway', 'primary');
      if (!go) return null;
    }
    return v;
  }
  // Reopening a Closed or Cancelled ticket — admin-only server side, reason required.
  if (TERMINAL_STATUSES.includes(t.status)) {
    return await formModal('Reopen ticket', [{ name: 'reason', label: 'Reason for reopening', type: 'textarea', required: true }], 'Reopen');
  }
  return {};
}
async function openRerouteModal(t) {
  let cats;
  try {
    const [it, me] = await Promise.all([api.categories('IT'), ME_ENABLED || t.department === 'ME' ? api.categories('ME') : []]);
    cats = { IT: it.map((c) => c.name), ME: me.map((c) => c.name) };
  } catch (e) { toast(e.message, 'error'); return; }
  const other = t.department === 'IT' ? 'ME' : 'IT';
  const opts = (dept) => cats[dept].map((n) => ({ value: n, label: n }));
  const v = await formModal('Re-route ticket', [
    { name: 'department', label: 'Department', type: 'select', value: t.department, options: [{ value: 'IT', label: 'IT (Information Technology)' }, { value: 'ME', label: 'ME (Mechanical)' }].filter((o) => ME_ENABLED || o.value !== 'ME' || t.department === 'ME') },
    { name: 'category_IT', label: 'IT category', type: 'select', required: true, value: t.department === 'IT' ? t.category : '', options: [{ value: '', label: 'Choose…' }, ...opts('IT')], showIf: (x) => x.department === 'IT' },
    { name: 'category_ME', label: 'ME category', type: 'select', required: true, value: t.department === 'ME' ? t.category : '', options: [{ value: '', label: 'Choose…' }, ...opts('ME')], showIf: (x) => x.department === 'ME' },
  ], 'Save', ME_ENABLED ? { intro: `Moving to ${other} is an escalation. The ticket number stays the same and the current team is kept.` } : {});
  if (!v) return;
  const category = v['category_' + v.department];
  const patch = {};
  if (v.department !== t.department) patch.department = v.department;
  if (category && category !== t.category) patch.category = category;
  if (!Object.keys(patch).length) return toast('Nothing to change', 'info');
  try { await api.patchTicket(t.id, patch); toast('Ticket re-routed', 'success'); renderTicketDetail(t.id); }
  catch (e) { toast(e.message, 'error'); }
}

/* --------------------------------------------------------------------------
   Invite Collaborator — technician-side flow.
   Shows the ticket context and the current team first, so the inviter can see
   who is already on it, then a searchable technician list with availability and
   workload. Never changes the ticket status.
   -------------------------------------------------------------------------- */
const AVAIL_CLASS = {
  'Available now': 'ok',
  'Busy': 'warn',
  'Off duty': 'off',
  'No schedule today': 'off',
};
function candidateRowHTML(c) {
  const already = c.is_primary ? 'Primary Technician' : c.is_collaborator ? 'Collaborator' : null;
  const disabled = c.is_self || !!already;
  const note = c.is_self ? 'You' : already ? 'Already ' + already : '';
  return `<label class="cand-row ${disabled ? 'is-disabled' : ''}" data-cand="${esc(c.username.toLowerCase())}">
    <input type="radio" name="cand" value="${c.id}" ${disabled ? 'disabled' : ''}>
    <div class="cand-main">
      <div class="cand-name">${esc(c.username)} ${note ? `<span class="muted">· ${esc(note)}</span>` : ''}</div>
      <div class="cand-meta">
        <span class="avail avail-${AVAIL_CLASS[c.availability] || 'off'}">${esc(c.availability || '—')}</span>
        <span class="muted">${c.workload} open ticket${c.workload === 1 ? '' : 's'}</span>
        <span class="muted">${esc(c.department || '')}</span>
      </div>
    </div>
  </label>`;
}
async function openInviteCollaboratorModal(t, after) {
  openModal({
    title: 'Invite Collaborator',
    bodyHTML: `<div id="inv-ctx" class="inv-ctx"><div class="loading-inline">Loading ticket team…</div></div>
      <div class="field"><label>Select technician</label>
        <input id="inv-search" type="search" placeholder="Search technician by name…" autocomplete="off">
      </div>
      <div id="inv-list" class="cand-list"><div class="loading-inline">Loading technicians…</div></div>
      <div class="field mt"><label>Note / reason <span class="muted">(optional)</span></label>
        <textarea id="inv-note" rows="2" placeholder="Why do you need help on this ticket?"></textarea>
      </div>`,
    footHTML: `<button class="btn-ghost" data-cancel>Cancel</button><button class="btn-primary" data-invite>Invite Collaborator</button>`,
    size: 'lg',
    async onMount(ov, close) {
      $('[data-cancel]', ov).addEventListener('click', close);
      const inviteBtn = $('[data-invite]', ov);
      inviteBtn.disabled = true;
      try {
        const data = await api.assignableTechs(t.id);
        const collabNames = data.collaborators.map((c) => c.technician_name);
        $('#inv-ctx', ov).innerHTML = `
          <div class="inv-ticket">${esc(data.ticket.ticket_number || '#' + t.id)}</div>
          <dl class="info-list compact">
            <dt>Outlet</dt><dd>${esc(data.ticket.outlet_name || data.ticket.outlet_code || '—')}</dd>
            <dt>Category</dt><dd>${esc(data.ticket.category || '—')} · ${esc(data.ticket.department || '')}</dd>
            <dt>Primary Technician</dt><dd>${data.primary ? esc(data.primary.technician_name) : '<span class="muted">No Primary Technician assigned yet.</span>'}</dd>
            <dt>Collaborators</dt><dd>${collabNames.length ? collabNames.map((n) => `<span class="badge badge-collab" style="margin-right:4px">${esc(n)}</span>`).join('') : '<span class="muted">No collaborators added yet.</span>'}</dd>
          </dl>`;
        const list = $('#inv-list', ov);
        const selectable = data.candidates.filter((c) => !c.is_self && !c.is_primary && !c.is_collaborator);
        list.innerHTML = data.candidates.length
          ? data.candidates.map(candidateRowHTML).join('')
          : `<p class="muted">No technicians available in this department.</p>`;
        if (!selectable.length && data.candidates.length) {
          list.innerHTML += `<p class="muted mt">Everyone in this department is already on this ticket.</p>`;
        }
        inviteBtn.disabled = !selectable.length;
        // Client-side filter over the already-loaded list.
        $('#inv-search', ov).addEventListener('input', (e) => {
          const q = e.target.value.trim().toLowerCase();
          $$('.cand-row', ov).forEach((row) => {
            row.style.display = !q || row.dataset.cand.includes(q) ? '' : 'none';
          });
        });
      } catch (e) {
        $('#inv-list', ov).innerHTML = errBox(e);
        return;
      }
      inviteBtn.addEventListener('click', async () => {
        const picked = $('input[name="cand"]:checked', ov);
        if (!picked) { toast('Pick a technician to invite', 'error'); return; }
        // Guard against a double-click creating two invites.
        if (inviteBtn.disabled) return;
        inviteBtn.disabled = true; inviteBtn.textContent = 'Inviting…';
        try {
          const res = await api.inviteCollaborator(t.id, {
            technician_id: Number(picked.value),
            note: $('#inv-note', ov).value.trim() || undefined,
          });
          toast(`${res.collaborator.technician_name} added as Collaborator`, 'success');
          close();
          if (after) after();
        } catch (e) {
          toast(e.message, 'error');
          inviteBtn.disabled = false; inviteBtn.textContent = 'Invite Collaborator';
        }
      });
    },
  });
}

// Assignment modal with multi-technician support (Primary + Collaborators)
async function openAssignModal(t, after) {
  openModal({
    title: 'Manage Assignment · ' + (t.ticket_number || '#' + t.id),
    bodyHTML: `
      <div class="assign-sec">
        <h4 class="assign-h">Current Assigned Team</h4>
        <div id="cur-assign-box"><div class="loading-inline">Loading current assignment…</div></div>
      </div>
      <div class="assign-sec">
        <h4 class="assign-h">Recommended Technicians</h4>
        <div id="rec-box"><div class="loading-inline">Finding available technicians…</div></div>
      </div>
      <div class="assign-sec">
        <h4 class="assign-h">Manual Assignment</h4>
        <div class="field"><label>Select technician</label><select id="manual-tech"><option value="">Choose technician…</option></select></div>
        <div class="row gap-sm wrap">
          <button class="btn-primary" data-manual="primary" style="padding:8px 14px">Set as Primary</button>
          <button class="btn-outline" data-manual="collaborator" style="padding:8px 14px">Add as Collaborator</button>
        </div>
        <details class="assign-adv mt">
          <summary>Advanced options</summary>
          <label class="row gap-sm mt" style="cursor:pointer;font-size:.82rem"><input type="checkbox" id="ov-check" style="width:auto"> Force even if wrong department / off-duty</label>
          <div class="hint">Only use this when a ticket genuinely needs a technician from the other department.</div>
        </details>
      </div>`,
    footHTML: `<button class="btn-ghost" data-cancel>Close</button>`,
    size: 'lg',
    async onMount(ov, close) {
      $('[data-cancel]', ov).addEventListener('click', close);
      const override = () => !!($('#ov-check', ov) || {}).checked;
      try {
        const [ticketData, recs, techs] = await Promise.all([
          api.ticket(t.id),
          api.recommend(t.id).catch(() => []),
          api.technicians(t.department).catch(() => []),
        ]);

        const primary = ticketData.primaryTechnician || null;
        const collabs = ticketData.collaborators || [];
        const curBox = $('#cur-assign-box', ov);
        curBox.innerHTML = `
          ${primary ? `<div class="team-row team-primary">
              <div class="team-avatar">${esc(techInitials(primary.technician_name))}</div>
              <div class="team-id"><div class="team-name">${esc(primary.technician_name)}</div><div class="team-role">Primary Technician / PIC</div></div>
              ${actionGroup(iconBtn({ icon: 'trash', label: `Remove ${primary.technician_name} as Primary Technician`, title: 'Remove from ticket', danger: true, attrs: `data-remove-tech="${primary.technician_id}"` }))}
            </div>` : `<div class="team-empty">No Primary Technician assigned yet.</div>`}
          <div class="team-sub">Collaborators</div>
          ${collabs.length ? collabs.map((c) => `<div class="team-row team-collab">
              <div class="team-avatar sm">${esc(techInitials(c.technician_name))}</div>
              <div class="team-id"><div class="team-name">${esc(c.technician_name)}</div><div class="team-role">Collaborator</div></div>
              ${actionGroup(
                iconBtn({ icon: 'star', label: `Make ${c.technician_name} the Primary Technician`, title: 'Set as Primary', attrs: `data-promote="${c.technician_id}"` }),
                iconBtn({ icon: 'trash', label: `Remove ${c.technician_name} from Collaborators`, title: 'Remove Collaborator', danger: true, attrs: `data-remove-tech="${c.technician_id}"` }),
              )}
            </div>`).join('') : `<div class="team-empty">No collaborators added yet.</div>`}`;

        $$('[data-remove-tech]', ov).forEach((b) => b.addEventListener('click', () =>
          doAssign(t, b.dataset.removeTech, null, false, close, after, 'remove')));
        $$('[data-promote]', ov).forEach((b) => b.addEventListener('click', () =>
          doAssign(t, b.dataset.promote, 'primary', override(), close, after)));

        const onTeam = (id) => (primary && primary.technician_id === id) || collabs.some((c) => c.technician_id === id);
        const rb = $('#rec-box', ov);
        rb.innerHTML = recs.length ? recs.map((r, i) => `
          <div class="rec-item ${i === 0 && r.available ? 'best' : ''}">
            <div class="rec-info"><div class="rec-name">${esc(r.username)} ${i === 0 && r.available ? '⭐' : ''}</div><div class="rec-reasons">${esc(r.reasons.join(' · '))}</div></div>
            <span class="rec-avail ${r.available ? 'yes' : 'no'}">${esc(r.availability || (r.available ? 'Available now' : 'Busy'))}</span>
            ${onTeam(r.id)
              ? `<span class="muted" style="font-size:.78rem">${primary && primary.technician_id === r.id ? 'Primary' : 'Collaborator'}</span>`
              : `<button class="btn-primary" data-rec-primary="${r.id}" style="padding:7px 12px">${primary ? 'Change Primary' : 'Set as Primary'}</button>
                 <button class="btn-outline" data-rec-collab="${r.id}" style="padding:7px 12px">Add as Collaborator</button>`}
          </div>`).join('') : '<p class="muted">No technicians configured for this department.</p>';

        $('#manual-tech', ov).innerHTML = '<option value="">Choose technician…</option>' +
          techs.filter((x) => x.is_active).map((x) => `<option value="${x.id}">${esc(x.username)} (${x.workload} open)${onTeam(x.id) ? ' · already assigned' : ''}</option>`).join('');
        $$('[data-rec-primary]', ov).forEach((b) => b.addEventListener('click', () => doAssign(t, b.dataset.recPrimary, 'primary', override(), close, after)));
        $$('[data-rec-collab]', ov).forEach((b) => b.addEventListener('click', () => doAssign(t, b.dataset.recCollab, 'collaborator', override(), close, after)));
      } catch (e) { $('#rec-box', ov).innerHTML = errBox(e); }

      $$('[data-manual]', ov).forEach((b) => b.addEventListener('click', () => {
        const id = $('#manual-tech', ov).value;
        if (!id) { toast('Pick a technician', 'error'); return; }
        doAssign(t, id, b.dataset.manual, override(), close, after);
      }));
    },
  });
}
async function doAssign(t, techId, roleType, override, close, after, action) {
  const body = { technician_id: Number(techId), override };
  if (action) body.action = action;
  else body.role_type = roleType || 'primary';
  try {
    await api.assign(t.id, body);
    toast(action === 'remove' ? 'Technician removed from the team' : 'Technician assignment updated',
      action === 'remove' ? 'info' : 'success');
    close(); if (after) after();
  } catch (e) {
    if (/override/i.test(e.message)) toast(e.message + ' Tick “Advanced options → Force” to override.', 'error');
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
  const lockedDept = !ME_ENABLED ? 'IT' : state.user.role === 'AdminIT' ? 'IT' : state.user.role === 'AdminME' ? 'ME' : '';
  schedState.lockedDept = lockedDept;
  schedState.dept = lockedDept || schedState.dept || '';
  view().innerHTML = `
    <div class="page-head"><h2>Technician schedules</h2><p>Weekly technician availability for planning coverage and assignments.</p></div>
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
    // One request for the whole roster (schedules + day-off blocks bundled).
    const techs = await api.technicians(schedState.dept || undefined, 'schedules');
    schedState.data = techs.map((t) => ({ tech: t, schedules: t.schedules || [], unavailability: t.unavailability || [] }));
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
      ${stat(all.length, 'Technicians')}${ME_ENABLED ? stat(it, 'IT', 'is-it') + stat(me, 'ME', 'is-me') : ''}
      ${stat(isCurrent ? availNow : '—', 'Available now', 'is-ok')}${stat(isCurrent ? offNow : '—', 'Off / blocked', 'is-off')}
    </div>
    <div class="sched-side-sec"><div class="sched-side-h">Technicians</div><div class="sched-techlist">${rows || '<p class="muted" style="font-size:.8rem;padding:4px 2px">No technicians</p>'}</div></div>
    <div class="sched-side-sec"><div class="sched-side-h">Legend</div><div class="sched-legend2">
      <span><i class="sw sw-it"></i>IT working hours</span>${ME_ENABLED ? '<span><i class="sw sw-me"></i>ME working hours</span>' : ''}
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
    const week = DOW.map((dn, i) => `<div class="sched-daycol${i === today ? ' is-today' : ''}"><div class="sched-dayname">${dn}</div><div class="sched-daybody">${byDay[i].length ? byDay[i].map((s) => `<div class="sched-block"><span class="sched-time">${esc(s.start_time)}–${esc(s.end_time)}</span><button type="button" class="sched-del" data-del="${s.id}" data-tech="${t.id}" title="Remove working hours" aria-label="Remove working hours ${esc(s.start_time)}–${esc(s.end_time)}">${svg(ICONS.trash, 13)}</button></div>`).join('') : '<div class="sched-off-cell">Off</div>'}</div></div>`).join('');
    const timeoff = row.unavailability.length ? `<div class="sched-timeoff"><div class="sched-timeoff-label">Day off / blocked time</div><div class="sched-timeoff-list">${row.unavailability.map((u) => `<div class="sched-offblock"><span class="sched-offblock-range">${esc(fmtDate(u.start_datetime))} → ${esc(fmtDate(u.end_datetime))}</span>${u.reason ? `<span class="sched-offblock-reason">${esc(u.reason)}</span>` : ''}<button type="button" class="sched-del" data-udel="${u.id}" data-tech="${t.id}" title="Remove day off / blocked time" aria-label="Remove day off block">${svg(ICONS.trash, 13)}</button></div>`).join('')}</div></div>` : '';
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
  const v = await formModal('Add working hours: ' + t.username, [
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
  const v = await formModal('Add day off / block: ' + t.username, [
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
// variant: 'danger' (default, destructive) | 'primary' (a soft "are you sure?")
function confirmModal(title, message, okLabel = 'Delete', variant = 'danger') {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (v) => { if (!settled) { settled = true; resolve(v); } };
    openModal({
      title,
      bodyHTML: `<p class="confirm-text">${esc(message)}</p>`,
      footHTML: `<button class="btn-ghost" data-cancel>Cancel</button><button class="btn-${variant === 'primary' ? 'primary' : 'danger'}" data-ok>${esc(okLabel)}</button>`,
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
  // ['dept', 'Department'], // IT vs ME comparison, hidden while ME is off (see ME_ENABLED)
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

function slaBadge(s) {
  const cls = { 'Met': 'st-Resolved', 'Breached': 'st-Cancelled', 'At Risk': 'ur-High', 'Not Started': 'st-New', 'On Track': 'st-Open' }[s] || 'st-Assigned';
  return `<span class="badge ${cls}">${esc(s || '—')}</span>`;
}
const localISO = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

async function renderReports() {
  const showDept = ME_ENABLED && ['SuperAdmin', 'Leader'].includes(state.user.role);
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

  view().innerHTML = `<div class="page-head"><h2>Reporting &amp; Performance</h2><p>Team performance and SLA results${state.user.role !== 'SuperAdmin' ? ` · ${esc(state.user.department || state.user.role)} scope` : ''}</p></div>
    <div class="card mb no-print report-filters">
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
        <div class="field"><label>Status</label><select id="r-status"><option value="">All</option>
          <optgroup label="Main flow (grouped)">${['New', 'Open', 'On Progress', 'Closed', 'Cancelled'].map((g) => `<option value="g:${esc(g)}">${esc(g)} (all)</option>`).join('')}</optgroup>
          <optgroup label="Exact status">${STATUSES.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join('')}</optgroup>
        </select></div>
        <div class="field"><label>Urgency</label><select id="r-urg"><option value="">All</option>${URGENCIES.map((s) => `<option>${s}</option>`).join('')}</select></div>
        <div class="field"><label>SLA status</label><select id="r-sla"><option value="">All</option>${['Met', 'Breached', 'At Risk', 'Not Started', 'On Track'].map((s) => `<option>${s}</option>`).join('')}</select></div>
        <div class="field"><label>Scheduled from</label><input type="date" id="r-sfrom"></div>
        <div class="field"><label>Scheduled to</label><input type="date" id="r-sto"></div>
      </div>
      <div class="row wrap gap-sm">
        <button class="btn-primary" id="r-run">Generate</button>
        <button class="btn-outline" id="r-csv-raw">${svg(ICONS.download, 15)} CSV: tickets</button>
        <button class="btn-outline" id="r-csv-tech">${svg(ICONS.download, 15)} CSV: technicians</button>
        <button class="btn-outline" id="r-csv-sla">${svg(ICONS.download, 15)} CSV: SLA detail</button>
        <button class="btn-outline" id="r-print">${svg(ICONS.printer, 15)} Print</button>
      </div>
    </div>
    <div class="tabbar no-print" id="r-tabs">${REPORT_TABS.map(([k, l]) => `<button class="tab ${k === _reportTab ? 'active' : ''}" data-tab="${k}">${l}</button>`).join('')}</div>
    <div id="r-result"><div class="loading-inline">Generating report…</div></div>`;

  const params = () => {
    const q = new URLSearchParams();
    if (showDept && $('#r-dept') && $('#r-dept').value) q.append('department', $('#r-dept').value);
    const g = (id, key) => { const el = $(id); if (el && el.value) q.append(key, el.value); };
    g('#r-region', 'region'); g('#r-brand', 'brand'); g('#r-outlet', 'outlet');
    g('#r-tech', 'technician'); g('#r-cat', 'category');
    // Status: exact value, or "g:<group>" → status_group (actual statuses kept).
    const stEl = $('#r-status');
    if (stEl && stEl.value) {
      if (stEl.value.startsWith('g:')) q.append('status_group', stEl.value.slice(2));
      else q.append('status', stEl.value);
    }
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
      toast(`Report ready: ${_perf.summary.total} ticket(s)`, _perf.summary.total ? 'success' : 'info');
    } catch (e) {
      const status = e.status || '?';
      console.error(`[Reporting] ${url} failed (HTTP ${status})`, e);
      const hint = status === 404
        ? 'Reporting endpoint not found. The server may need to be restarted to load the latest routes.'
        : status === 403
          ? 'You do not have permission to view the performance report.'
          : (e.message || 'Please try again.');
      $('#r-result').innerHTML = `<div class="empty"><h3>Couldn’t load the report</h3><p>${esc(hint)}</p><p class="muted" style="font-size:.78rem">GET ${esc(url)} → HTTP ${esc(status)}</p></div>`;
      toast(`Report failed (HTTP ${status})`, 'error');
    }
  };
  $('#r-run').addEventListener('click', run);
  const openCsv = async (kind) => {
    const qp = params(); if (kind) qp.append('export', kind);
    const btn = $('#r-csv-' + (kind === 'technician' ? 'tech' : kind));
    if (btn) btn.disabled = true;
    try { await downloadCsv('/api/reports/export?' + qp.toString(), `${kind === 'raw' ? 'report' : kind}_${localISO(new Date())}.csv`); toast('CSV downloaded', 'success'); }
    catch (e) { toast(e.message || 'Export failed', 'error'); }
    finally { if (btn) btn.disabled = false; }
  };
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
      ${statCard(s.pending_outlet_response || 0, 'Pending Outlet Response')}
      ${statCard(s.escalated || 0, 'Escalated', 'danger')}
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
    <div class="hint" style="padding:6px 4px">SLA targets: Critical ${fmtMins(p.targets.Critical)} · High ${fmtMins(p.targets.High)} · Medium ${fmtMins(p.targets.Medium)} · Low ${fmtMins(p.targets.Low)} (configurable).</div>
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
  return `<div class="panel"><div class="panel-head"><h3>Department Performance: IT vs ME</h3></div><div class="table-wrap"><table class="data">
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
  return `<div class="panel"><div class="panel-head"><h3>SLA Detail · ${p.tickets.length} ticket(s)</h3></div><div class="table-wrap"><table class="data">
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
  const roles = assignableRoles();
  view().innerHTML = `
    <div class="page-head page-head-row">
      <div><h2>Users</h2><p>Staff accounts, roles and access scope</p></div>
      <div class="page-actions"><button class="btn-primary" id="u-add">${svg(ICONS.plus, 16)} Add user</button></div>
    </div>
    <div class="toolbar">
      <div class="search">${svg(ICONS.search, 16)}<input id="u-search" type="search" placeholder="Search name, email or phone…" aria-label="Search users"></div>
      <select id="u-role" aria-label="Role"><option value="">All roles</option>${roles.map((r) => `<option value="${r}">${esc(ROLE_LABEL[r] || r)}</option>`).join('')}</select>
      <select id="u-state" aria-label="Account state"><option value="">Any state</option><option value="active">Active</option><option value="inactive">Inactive</option><option value="locked">Locked out</option></select>
    </div>
    <div class="list-meta" id="u-meta"></div>
    <div class="panel"><div class="table-wrap"><table class="data table-cards"><thead><tr><th>Name</th><th>Role</th><th>Contact</th><th>Access</th><th>Last sign-in</th><th>Status</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody id="u-body"><tr><td colspan="7" class="loading-inline">Loading…</td></tr></tbody></table></div></div>`;
  let all = [];
  const draw = () => {
    const term = $('#u-search').value.trim().toLowerCase();
    const role = $('#u-role').value;
    const st = $('#u-state').value;
    const rows = all
      .filter((u) => canManageTargetRole(state.user.role, u.role))
      .filter((u) => !role || u.role === role)
      .filter((u) => !st || (st === 'active' ? u.is_active && !u.is_locked : st === 'inactive' ? !u.is_active : u.is_locked))
      .filter((u) => !term || [u.username, u.email, u.phone].some((x) => String(x || '').toLowerCase().includes(term)));
    $('#u-meta').innerHTML = `<span class="count"><b>${rows.length}</b> of ${all.length} user${all.length === 1 ? '' : 's'}</span>`
      + `<span class="muted small">${all.filter((u) => u.is_active).length} active · ${all.filter((u) => u.is_locked).length} locked</span>`;
    $('#u-body').innerHTML = rows.length ? rows.map(userRow).join('') : '<tr><td colspan="7" class="empty-cell">No users match</td></tr>';
    $$('[data-edit]').forEach((b) => b.addEventListener('click', () => openUserModal(all.find((x) => x.id === Number(b.dataset.edit)), reload)));
    $$('[data-del]').forEach((b) => b.addEventListener('click', () => confirmDeleteUser(all.find((x) => x.id === Number(b.dataset.del)), reload)));
    $$('[data-unlock]').forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true;
      try { await api.unlockUser(Number(b.dataset.unlock)); toast('Account unlocked', 'success'); reload(); }
      catch (e) { toast(e.message, 'error'); b.disabled = false; }
    }));
  };
  const reload = async () => { all = await api.users(); draw(); };
  $('#u-add').addEventListener('click', () => openUserModal(null, reload));
  $('#u-search').addEventListener('input', debounce(draw, 150));
  $('#u-role').addEventListener('change', draw);
  $('#u-state').addEventListener('change', draw);
  try { await reload(); } catch (e) { $('#u-body').innerHTML = `<tr><td colspan="7">${errBox(e, reload)}</td></tr>`; }
}
function userRow(u) {
  const self = state.user.id === u.id;
  const isTech = /^Technician/.test(u.role);
  let access = u.all_brands ? 'All brands' : (u.brand || '—');
  if (isTech) access = u.all_outlets ? 'Whole department' : `${(u.outlet_access || []).length} PIC outlet(s)`;
  const status = !u.is_active
    ? '<span class="badge st-Cancelled">Inactive</span>'
    : u.is_locked ? '<span class="badge st-Escalated" title="Too many failed sign-ins">Locked</span>' : '<span class="badge st-Resolved">Active</span>';
  return `<tr class="${u.is_active ? '' : 'row-muted'}">
    <td data-label="Name"><div class="person"><span class="avatar sm">${esc(techInitials(u.username))}</span><div><strong>${esc(u.username)}</strong>${self ? ' <span class="team-you">you</span>' : ''}<div class="muted small">${esc(u.email)}</div></div></div></td>
    <td data-label="Role"><span class="role-pill role-${esc(u.role)}">${esc(ROLE_LABEL[u.role] || u.role)}</span>${u.department ? ` ${deptTag(u.department)}` : ''}</td>
    <td data-label="Contact">${u.phone ? `<a href="tel:${esc(String(u.phone).replace(/[^\d+]/g, ''))}">${esc(u.phone)}</a>` : '<span class="muted">—</span>'}${u.region ? `<div class="muted small">${esc(u.region)}</div>` : ''}</td>
    <td data-label="Access">${esc(access)}${isTech && u.pic_area ? `<div class="muted small">${esc(u.pic_area)}</div>` : ''}</td>
    <td data-label="Last sign-in"><span title="${esc(fmtFull(u.last_login_at))}">${u.last_login_at ? esc(timeAgo(u.last_login_at)) : '<span class="muted">never</span>'}</span></td>
    <td data-label="Status">${status}</td>
    ${actionCell(
      u.is_locked && iconBtn({ icon: 'unlock', label: `Unlock ${u.username}`, title: 'Unlock account', attrs: `data-unlock="${u.id}"` }),
      iconBtn({ icon: 'pencil', label: `Edit ${u.username}`, title: 'Edit', attrs: `data-edit="${u.id}"` }),
      iconBtn({
        icon: 'trash', label: `Delete ${u.username}`, danger: true, disabled: self,
        title: self ? 'You cannot delete your own account' : 'Delete',
        attrs: self ? '' : `data-del="${u.id}"`,
      }),
    )}
  </tr>`;
}
const ALL_ROLES = ['Requestor', 'TechnicianIT', 'TechnicianME', 'AdminIT', 'AdminME', 'Leader', 'SuperAdmin']
  .filter((r) => ME_ENABLED || !r.endsWith('ME'));
// UX mirror of src/utils/permissions.js — the server re-enforces all of it.
const MANAGEABLE_ROLES = {
  AdminIT: ['Requestor', 'TechnicianIT', 'AdminIT', 'Leader'],
  AdminME: ['Requestor', 'TechnicianME', 'AdminME', 'Leader'],
};
function canManageTargetRole(currentRole, targetRole) {
  if (currentRole === 'SuperAdmin') return true;
  return (MANAGEABLE_ROLES[currentRole] || []).includes(targetRole);
}
function assignableRoles() {
  return ALL_ROLES.filter((r) => canManageTargetRole(state.user.role, r));
}
async function openUserModal(u, after) {
  const isEdit = !!u;
  const isSelf = isEdit && u.id === state.user.id;
  let brands = [], outlets = [];
  try { [brands, outlets] = await Promise.all([api.brands(), api.allOutlets().catch(() => api.outlets())]); }
  catch (_) {}
  const brandOptions = [{ value: '', label: 'None' }, ...brands.map((b) => ({ value: b.code, label: `${b.code} · ${b.name}` }))];
  const outletOptions = outlets.map((o) => ({ value: o.code, label: `${o.code}${o.name && o.name !== o.code ? ' ' + o.name : ''} · ${o.region || '—'}` }));
  const isTechRole = (v) => /^Technician/.test(v.role);

  const fields = [
    { type: 'section', name: 's_account', label: 'Account' },
    { name: 'username', label: 'Full name', required: true, value: u ? u.username : '', maxlength: 120, autocomplete: 'off' },
    { name: 'email', label: 'Work email', type: 'email', required: true, value: u ? u.email : '', maxlength: 254, autocomplete: 'off' },
    { name: 'phone', label: 'WhatsApp / phone', type: 'tel', value: u ? (u.phone || '') : '', maxlength: 40, placeholder: '0812…', hint: 'Used for WhatsApp alerts on new tickets (admins & technicians).' },
    { name: 'role', label: 'Role', type: 'select', value: u ? u.role : 'Requestor', options: assignableRoles().map((r) => ({ value: r, label: ROLE_LABEL[r] || r, disabled: isSelf && r !== u.role })), hint: isSelf ? 'You cannot change your own role.' : '' },
    { name: 'region', label: 'Region', type: 'select', value: u ? (u.region || '') : '', options: [{ value: '', label: '— Not set —' }, ...REGIONS.map((r) => ({ value: r, label: r }))] },
    { type: 'section', name: 's_scope', label: 'Access scope', showIf: (v) => v.role !== 'SuperAdmin' },
    { name: 'brand', label: 'Brand', type: 'select', value: u ? (u.brand || '') : '', options: brandOptions, hint: 'Limits admins, leaders and requestors to one brand unless "All brands" is on.', showIf: (v) => !isTechRole(v) && v.role !== 'SuperAdmin' },
    { name: 'all_brands', label: '', type: 'checkbox', checkboxLabel: 'All brands', value: u ? !!u.all_brands : false, showIf: (v) => !isTechRole(v) && v.role !== 'SuperAdmin' },
    { name: 'pic_area', label: 'PIC area label', value: u ? (u.pic_area || '') : '', placeholder: 'e.g. IT Area 1', maxlength: 80, showIf: isTechRole },
    { name: 'all_outlets', label: '', type: 'checkbox', checkboxLabel: 'Can see the whole department (all outlets)', value: u ? !!u.all_outlets : false, showIf: isTechRole },
    { name: 'outlet_access', label: 'PIC outlets', type: 'multiselect', value: u ? (u.outlet_access || []) : [], options: outletOptions, hint: 'Tickets from these outlets show in the technician\'s default list.', showIf: (v) => isTechRole(v) && !v.all_outlets },
    { name: 'can_close_override', label: '', type: 'checkbox', checkboxLabel: 'May close tickets as PIC even without an assignment record', value: u ? !!u.can_close_override : false, showIf: isTechRole },
    { type: 'section', name: 's_security', label: 'Sign-in' },
    { name: 'is_active', label: 'Active', type: 'toggle', checkboxLabel: 'Account active', value: u ? !!u.is_active : true, onText: 'Can sign in', offText: 'Blocked, history is kept', hint: isSelf ? 'You cannot deactivate yourself.' : '' },
    { name: 'password', label: isEdit ? 'New password' : 'Password', type: 'password', required: !isEdit, hint: `${isEdit ? 'Leave blank to keep the current password. Setting one signs the user out everywhere. ' : ''}10+ characters with upper & lower case, a number and a symbol.` },
  ];

  const v = await formModal(isEdit ? `Edit ${u.username}` : 'Add user', fields, isEdit ? 'Save changes' : 'Create user', { size: 'lg' });
  if (!v) return;
  if (v.password && !/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{10,128}$/.test(v.password))
    return toast('Password needs 10+ characters with upper & lower case, a number and a symbol', 'error');
  if (isSelf && !v.is_active) return toast('You cannot deactivate your own account', 'error');
  const tech = /^Technician/.test(v.role);
  const payload = {
    username: v.username, email: v.email, phone: v.phone || null, region: v.region || null,
    is_active: v.is_active,
  };
  if (!isSelf) payload.role = v.role;
  if (tech) {
    Object.assign(payload, {
      pic_area: v.pic_area || null, all_outlets: !!v.all_outlets, can_close_override: !!v.can_close_override,
      outlet_access: v.all_outlets ? (u ? u.outlet_access || [] : []) : (v.outlet_access || []),
    });
  } else if (v.role !== 'SuperAdmin') {
    Object.assign(payload, { brand: v.brand || null, all_brands: !!v.all_brands });
  }
  if (v.password) payload.password = v.password;
  try {
    if (isEdit) await api.patchUser(u.id, payload); else await api.createUser(payload);
    toast(isEdit ? 'User updated' : 'User created', 'success');
    if (isSelf) { state.user = await api.me(); boot(); }
    after();
  } catch (e) { toast(e.message, 'error'); }
}
/* Shared delete flow for the master-data tables. Confirm first, never delete on
   the click itself; on success toast + refresh; on failure surface the server's
   message. When the server refuses because the record is still referenced it
   says so and points at the Active toggle, so the operator has a way forward
   instead of a dead end. */
async function confirmDeleteRow({ what, name, note, del, after }) {
  const ok = await confirmModal(
    `Delete ${what}?`,
    `"${name}" will be permanently deleted. This cannot be undone.` + (note ? ` ${note}` : ''),
    'Delete',
  );
  if (!ok) return;
  try {
    await del();
    toast(`${what[0].toUpperCase()}${what.slice(1)} deleted`, 'success');
    await after();
  } catch (e) {
    toast(e.message, 'error');
  }
}
const confirmDeleteUser = (u, after) => confirmDeleteRow({
  what: 'user', name: u.username, del: () => api.delUser(u.id), after,
  note: 'Set Active off in Edit instead if you only want to block sign-in.',
});

// ==========================================================================
// View: Categories
// ==========================================================================
async function renderCategories() {
  const myDept = DEPT_OF_ROLE[state.user.role] || '';
  view().innerHTML = `
    <div class="page-head page-head-row">
      <div><h2>Categories</h2><p>What people can pick when reporting an issue${myDept ? ` · you manage ${myDept} categories` : ''}</p></div>
      <div class="page-actions"><button class="btn-primary" id="cat-add">${svg(ICONS.plus, 16)} Add category</button></div>
    </div>
    <div class="toolbar">
      <div class="search">${svg(ICONS.search, 16)}<input id="cat-search" type="search" placeholder="Search category…" aria-label="Search categories"></div>
      <div class="seg" id="cat-dept" role="group" aria-label="Department">
        ${ME_ENABLED ? `<button class="seg-b ${myDept ? '' : 'active'}" data-d="">All</button>
        <button class="seg-b ${myDept === 'IT' ? 'active' : ''}" data-d="IT">IT</button>
        <button class="seg-b ${myDept === 'ME' ? 'active' : ''}" data-d="ME">ME</button>` : ''}
      </div>
    </div>
    <div class="list-meta" id="cat-meta"></div>
    <div class="panel"><div class="table-wrap"><table class="data table-cards">
      <thead><tr><th>Category</th><th>Department</th><th class="num">Tickets</th><th class="num">Order</th><th>Status</th><th><span class="sr-only">Actions</span></th></tr></thead>
      <tbody id="cat-body"><tr><td colspan="6" class="loading-inline">Loading…</td></tr></tbody>
    </table></div></div>`;

  let all = [];
  let dept = ME_ENABLED ? myDept : 'IT';
  const draw = () => {
    const term = $('#cat-search').value.trim().toLowerCase();
    const rows = all.filter((c) => (!dept || c.department_code === dept) && (!term || c.name.toLowerCase().includes(term)));
    $('#cat-meta').innerHTML = `<span class="count"><b>${rows.length}</b> categor${rows.length === 1 ? 'y' : 'ies'}</span><span class="muted small">${rows.filter((c) => !c.active).length} inactive</span>`;
    $('#cat-body').innerHTML = rows.length ? rows.map(categoryRow).join('') : '<tr><td colspan="6" class="empty-cell">No categories found</td></tr>';
    $$('[data-edit-cat]').forEach((b) => b.addEventListener('click', () => openCategoryModal(all.find((x) => x.id === Number(b.dataset.editCat)), reload)));
    $$('[data-del-cat]').forEach((b) => b.addEventListener('click', () => confirmDeleteCategory(all.find((x) => x.id === Number(b.dataset.delCat)), reload)));
  };
  const reload = async () => {
    try { all = await api.allCategories(); draw(); }
    catch (e) { const tb = $('#cat-body'); if (tb) tb.innerHTML = `<tr><td colspan="6">${errBox(e, reload)}</td></tr>`; }
  };
  $('#cat-add').addEventListener('click', () => openCategoryModal(null, reload));
  $('#cat-search').addEventListener('input', debounce(draw, 150));
  $$('#cat-dept .seg-b').forEach((b) => b.addEventListener('click', () => {
    dept = b.dataset.d;
    $$('#cat-dept .seg-b').forEach((x) => x.classList.toggle('active', x === b));
    draw();
  }));
  await reload();
}

function categoryRow(c) {
  const statusBadge = c.active ? '<span class="badge st-Resolved">Active</span>' : '<span class="badge st-Cancelled">Inactive</span>';
  const locked = c.can_manage === false;
  const inUse = c.ticket_count > 0;
  return `
    <tr class="${c.active ? '' : 'row-muted'}">
      <td data-label="Category"><strong>${esc(c.name)}</strong></td>
      <td data-label="Department">${deptTag(c.department_code)}</td>
      <td data-label="Tickets" class="num">${c.ticket_count ? `<a href="${esc(q({ category: c.name, department: c.department_code }))}" data-goto="${esc(q({ category: c.name, department: c.department_code }))}">${c.ticket_count}</a>` : '0'}</td>
      <td data-label="Order" class="num">${esc(c.sort_order)}</td>
      <td data-label="Status">${statusBadge}</td>
      ${actionCell(
        iconBtn({ icon: 'pencil', label: `Edit category ${c.name}`, title: locked ? `Only ${c.department_code} staff can edit this` : 'Edit', disabled: locked, attrs: locked ? '' : `data-edit-cat="${c.id}"` }),
        iconBtn({ icon: 'trash', label: `Delete category ${c.name}`, danger: true, disabled: locked || inUse,
          title: locked ? `Only ${c.department_code} staff can delete this` : inUse ? `Used by ${c.ticket_count} ticket(s). Switch it to inactive instead` : 'Delete',
          attrs: locked || inUse ? '' : `data-del-cat="${c.id}"` }),
      )}
    </tr>`;
}

async function openCategoryModal(c, after) {
  const isEdit = !!c;
  const myDept = DEPT_OF_ROLE[state.user.role];
  const deptOptions = [{ value: 'IT', label: 'IT (Information Technology)' }, { value: 'ME', label: 'ME (Mechanical)' }]
    .filter((o) => (!myDept || o.value === myDept) && (ME_ENABLED || o.value !== 'ME'));
  const v = await formModal(isEdit ? `Edit “${c.name}”` : 'Add category', [
    { name: 'department_code', label: 'Department', type: 'select', value: c ? c.department_code : (myDept || 'IT'), options: deptOptions,
      hint: isEdit && c.ticket_count ? 'In use by tickets. The department cannot change.' : '' },
    { name: 'name', label: 'Category name', required: true, value: c ? c.name : '', maxlength: 60, placeholder: 'e.g. Network Outage',
      hint: isEdit && c.ticket_count ? `Renaming updates the ${c.ticket_count} existing ticket(s) too.` : '' },
    { name: 'sort_order', label: 'Display order', type: 'number', value: c ? String(c.sort_order) : '0', hint: 'Lower numbers appear first in the report form.' },
    { name: 'active', label: 'Active', type: 'toggle', checkboxLabel: 'Shown on the report form', value: c ? !!c.active : true, onText: 'Visible to reporters', offText: 'Hidden, kept on existing tickets' },
  ], isEdit ? 'Save' : 'Create');
  if (!v) return;
  const payload = { name: v.name, sort_order: Number(v.sort_order) || 0, active: v.active };
  if (!isEdit || v.department_code !== c.department_code) payload.department_code = v.department_code;
  try {
    if (isEdit) {
      const r = await api.patchCategory(c.id, payload);
      toast(r.tickets_renamed ? `Category updated · ${r.tickets_renamed} ticket(s) renamed` : 'Category updated', 'success');
    } else {
      await api.createCategory(payload);
      toast('Category created', 'success');
    }
    after();
  } catch (e) { toast(e.message, 'error'); }
}

const confirmDeleteCategory = (c, after) => confirmDeleteRow({
  what: 'category', name: c.name, del: () => api.deleteCategory(c.id), after,
});

// ==========================================================================
// View: Locations (outlets)
// ==========================================================================
async function renderLocations() {
  view().innerHTML = `
    <div class="page-head page-head-row">
      <div><h2>Locations</h2><p>Outlets people can report from, grouped by brand and region</p></div>
      <div class="page-actions"><button class="btn-primary" id="loc-add">${svg(ICONS.plus, 16)} Add location</button></div>
    </div>
    <div class="toolbar">
      <div class="search">${svg(ICONS.search, 16)}<input id="loc-search" type="search" placeholder="Search code, name or brand…" aria-label="Search locations"></div>
      <select id="loc-brand" aria-label="Brand"><option value="">All brands</option></select>
      <select id="loc-region" aria-label="Region"><option value="">All regions</option>${REGIONS.map((r) => `<option>${esc(r)}</option>`).join('')}</select>
    </div>
    <div class="list-meta" id="loc-meta"></div>
    <div class="panel"><div class="table-wrap"><table class="data table-cards">
      <thead><tr><th>Code</th><th>Name</th><th>Brand</th><th>Region</th><th class="num">Open / total</th><th>Status</th><th><span class="sr-only">Actions</span></th></tr></thead>
      <tbody id="loc-body"><tr><td colspan="7" class="loading-inline">Loading…</td></tr></tbody>
    </table></div></div>`;

  let all = [];
  const draw = () => {
    const term = $('#loc-search').value.trim().toLowerCase();
    const brand = $('#loc-brand').value;
    const region = $('#loc-region').value;
    const rows = all.filter((o) =>
      (!brand || o.brand_code === brand) && (!region || (o.region || 'Jakarta') === region)
      && (!term || [o.code, o.name, o.brand_code, o.display_label].some((x) => String(x || '').toLowerCase().includes(term))));
    $('#loc-meta').innerHTML = `<span class="count"><b>${rows.length}</b> location${rows.length === 1 ? '' : 's'}</span><span class="muted small">${rows.reduce((a, o) => a + (o.open_count || 0), 0)} open tickets</span>`;
    $('#loc-body').innerHTML = rows.length ? rows.map(outletRow).join('') : '<tr><td colspan="7" class="empty-cell">No locations found</td></tr>';
    $$('[data-edit-loc]').forEach((b) => b.addEventListener('click', () => openOutletModal(all.find((x) => x.id === Number(b.dataset.editLoc)), reload)));
    $$('[data-del-loc]').forEach((b) => b.addEventListener('click', () => confirmDeleteOutlet(all.find((x) => x.id === Number(b.dataset.delLoc)), reload)));
    wireCardLinks('#loc-body');
  };
  const reload = async () => {
    try {
      all = await api.allOutlets();
      const sel = $('#loc-brand'); const cur = sel.value;
      sel.innerHTML = '<option value="">All brands</option>' + [...new Set(all.map((o) => o.brand_code))].sort().map((b) => `<option ${b === cur ? 'selected' : ''}>${esc(b)}</option>`).join('');
      draw();
    } catch (e) { const tb = $('#loc-body'); if (tb) tb.innerHTML = `<tr><td colspan="7">${errBox(e, reload)}</td></tr>`; }
  };
  $('#loc-add').addEventListener('click', () => openOutletModal(null, reload));
  $('#loc-search').addEventListener('input', debounce(draw, 150));
  $('#loc-brand').addEventListener('change', draw);
  $('#loc-region').addEventListener('change', draw);
  await reload();
}

function outletRow(o) {
  const statusBadge = o.active ? '<span class="badge st-Resolved">Active</span>' : '<span class="badge st-Cancelled">Inactive</span>';
  const inUse = o.ticket_count > 0;
  const link = q({ outlet: o.code });
  return `
    <tr class="${o.active ? '' : 'row-muted'}">
      <td data-label="Code"><strong class="mono">${esc(o.code)}</strong></td>
      <td data-label="Name">${esc(o.name)}${o.display_label && o.display_label !== o.name ? `<div class="muted small">shown as ${esc(o.display_label)}</div>` : ''}</td>
      <td data-label="Brand"><span class="brand-pill">${esc(o.brand_code)}</span></td>
      <td data-label="Region">${esc(o.region || 'Jakarta')}</td>
      <td data-label="Open / total" class="num">${inUse ? `<a href="${esc(link)}" data-goto="${esc(link)}"><b>${o.open_count || 0}</b> / ${o.ticket_count}</a>` : '<span class="muted">0 / 0</span>'}</td>
      <td data-label="Status">${statusBadge}</td>
      ${actionCell(
        iconBtn({ icon: 'pencil', label: `Edit location ${o.name}`, title: 'Edit', attrs: `data-edit-loc="${o.id}"` }),
        iconBtn({ icon: 'trash', label: `Delete location ${o.name}`, danger: true, disabled: inUse,
          title: inUse ? `Used by ${o.ticket_count} ticket(s). Switch it to inactive instead` : 'Delete',
          attrs: inUse ? '' : `data-del-loc="${o.id}"` }),
      )}
    </tr>`;
}

async function openOutletModal(o, after) {
  const isEdit = !!o;
  let brands = [];
  try { brands = await api.brands(); } catch (_) {}
  const NEW = '__new__';
  const brandOptions = [...brands.map((b) => ({ value: b.code, label: b.name && b.name !== b.code ? `${b.code} · ${b.name}` : b.code })), { value: NEW, label: '+ New brand…' }];
  const v = await formModal(isEdit ? `Edit ${o.code}` : 'Add location', [
    { name: 'brand_code', label: 'Brand', type: 'select', value: o ? o.brand_code : (brandOptions[0] ? brandOptions[0].value : NEW), options: brandOptions },
    { name: 'custom_brand_code', label: 'New brand code', required: true, placeholder: 'e.g. UNION', maxlength: 30, showIf: (x) => x.brand_code === NEW },
    { name: 'code', label: 'Outlet code', required: true, value: o ? o.code : '', placeholder: 'e.g. UTP', maxlength: 30,
      hint: isEdit && o.ticket_count ? `Changing the code also updates its ${o.ticket_count} ticket(s) and technician coverage.` : 'Short unique code: letters, numbers, - _ .' },
    { name: 'name', label: 'Outlet name', required: true, value: o ? o.name : '', placeholder: 'e.g. Union Plaza Senayan', maxlength: 100 },
    { name: 'display_label', label: 'Report label', value: o ? (o.display_label || '') : '', placeholder: 'Defaults to the outlet name', maxlength: 100, hint: 'Lets several outlets roll up under one name in reports.' },
    { name: 'region', label: 'Region', type: 'select', value: o ? (o.region || 'Jakarta') : 'Jakarta', options: REGIONS.map((r) => ({ value: r, label: r })) },
    { name: 'active', label: 'Active', type: 'toggle', checkboxLabel: 'Shown on the report form', value: o ? !!o.active : true, onText: 'Visible to reporters', offText: 'Hidden, kept on existing tickets' },
  ], isEdit ? 'Save' : 'Create');
  if (!v) return;
  const brandCode = (v.brand_code === NEW ? v.custom_brand_code : v.brand_code || '').trim().toUpperCase();
  if (!brandCode) return toast('Brand is required', 'error');
  const payload = {
    brand_code: brandCode,
    code: v.code.trim().toUpperCase(),
    name: v.name.trim(),
    display_label: v.display_label.trim() || v.name.trim(),
    region: v.region || 'Jakarta',
    active: v.active,
  };
  try {
    if (isEdit) {
      const r = await api.patchOutlet(o.id, payload);
      toast(r.tickets_moved ? `Location updated · ${r.tickets_moved} ticket(s) moved to ${payload.code}` : 'Location updated', 'success');
    } else {
      await api.createOutlet(payload);
      toast('Location created', 'success');
    }
    state.meta.outlets = null;
    after();
  } catch (e) { toast(e.message, 'error'); }
}

const confirmDeleteOutlet = (o, after) => confirmDeleteRow({
  what: 'location', name: `${o.code} · ${o.name}`, del: () => api.deleteOutlet(o.id), after,
});

// ==========================================================================
// View: Import / Export (CSV) — SuperAdmin (import) + admins (export)
// ==========================================================================
const IE_MODULES = [
  { key: 'users', label: 'Users', file: 'users.csv', cols: 'username, email, role, department, phone, is_active', upsert: 'Updates existing users matched by email. New emails are reported as errors. Create new users on the Users page.' },
  { key: 'locations', label: 'Locations', file: 'locations.csv', cols: 'code, name, brand_code, region, active', upsert: 'Adds new outlets and updates existing ones, matched by code.' },
  { key: 'schedules', label: 'Schedules', file: 'schedules.csv', cols: 'technician_email, day_of_week, start_time, end_time, active', upsert: 'Matched by technician + day_of_week + start/end time. day_of_week is 0 (Sun) – 6 (Sat).' },
];
async function renderImportExport() {
  const isSuper = state.user.role === 'SuperAdmin';
  view().innerHTML = `
    <div class="page-head"><h2>Import / Export</h2><p>${isSuper ? 'Export or bulk-import Users, Locations and Schedules as CSV.' : 'Export data as CSV. Importing is restricted to SuperAdmin.'}</p></div>
    <div class="ie-grid">
      ${IE_MODULES.map((m) => `
        <div class="panel">
          <div class="panel-head"><h3>${esc(m.label)}</h3></div>
          <div class="card" style="border:none">
            <p class="muted" style="font-size:.8rem;margin-bottom:4px">Columns</p>
            <p style="font-size:.8rem;margin-bottom:8px"><code>${esc(m.cols)}</code></p>
            <p class="hint" style="padding:0 0 12px">${esc(m.upsert)}</p>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <button class="btn-outline" data-export="${m.key}" data-file="${m.file}">${svg(ICONS.download, 15)} Export</button>
              ${isSuper ? `<button class="btn-primary" data-import="${m.key}">${svg(ICONS.upload, 15)} Import</button>` : ''}
            </div>
          </div>
        </div>`).join('')}
    </div>`;
  $$('[data-export]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    try { await downloadExport(b.dataset.export, b.dataset.file); toast('Export downloaded', 'success'); }
    catch (e) { toast(e.message, 'error'); }
    finally { b.disabled = false; }
  }));
  $$('[data-import]').forEach((b) => b.addEventListener('click', () => openImportModal(b.dataset.import)));
}
// Export downloads via rawFetch (keeps cookie auth + 401 re-auth), then saves the blob.
async function downloadExport(module, filename) {
  return downloadCsv('/api/export/' + module, filename);
}
async function downloadCsv(endpoint, filename) {
  const res = await rawFetch(endpoint, { method: 'GET' });
  if (!res.ok) { let m = 'Export failed'; try { m = (await res.json()).error || m; } catch (_) {} throw new Error(m); }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
// Import: pick a CSV → dry-run validate → preview → confirm → apply.
function openImportModal(module) {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.csv,text/csv,text/plain';
  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    let text;
    try { text = await file.text(); } catch (_) { toast('Could not read file', 'error'); return; }
    try {
      const res = await api.importData(module, text, true); // dry run — no writes
      showImportPreview(module, text, res);
    } catch (e) { toast(e.message, 'error'); }
  });
  input.click();
}
function showImportPreview(module, csvText, res) {
  const s = res.summary || { total: 0, valid: 0, invalid: 0, toInsert: 0, toUpdate: 0 };
  const canApply = s.invalid === 0 && s.valid > 0;
  const errRows = (res.errors || []).slice(0, 200).map((e) => `<tr><td>${esc(e.row)}</td><td class="muted">${esc(e.message)}</td></tr>`).join('');
  const dataCols = (res.preview && res.preview[0]) ? Object.keys(res.preview[0]).filter((c) => c !== 'action') : [];
  const prevRows = (res.preview || []).map((p) => `<tr><td><span class="badge ${p.action === 'insert' ? 'st-New' : 'st-Assigned'}">${esc(p.action)}</span></td>${dataCols.map((c) => `<td>${esc(p[c])}</td>`).join('')}</tr>`).join('');
  openModal({
    title: `Import ${module}: preview`,
    size: 'lg',
    bodyHTML: `
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">
        <span class="badge st-New">${s.total} rows</span>
        <span class="badge st-Resolved">${s.valid} valid</span>
        ${s.invalid ? `<span class="badge st-Cancelled">${s.invalid} invalid</span>` : ''}
        <span class="badge st-Assigned">${s.toInsert} insert</span>
        <span class="badge st-OnProgress">${s.toUpdate} update</span>
      </div>
      ${s.invalid ? `<div class="hint" style="color:var(--danger);padding:0 0 6px">Import is all-or-nothing. Fix the invalid row(s) below and re-upload; nothing is written until every row is valid.</div>
        <div class="table-wrap" style="max-height:160px;overflow:auto"><table class="data"><thead><tr><th>Row</th><th>Error</th></tr></thead><tbody>${errRows}</tbody></table></div>` : ''}
      ${dataCols.length ? `<div style="font-size:.82rem;font-weight:600;margin:12px 0 4px">Preview (first ${(res.preview || []).length})</div>
        <div class="table-wrap" style="max-height:240px;overflow:auto"><table class="data"><thead><tr><th>Action</th>${dataCols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${prevRows}</tbody></table></div>` : '<p class="muted">No valid rows to preview.</p>'}`,
    footHTML: `<button class="btn-ghost" data-cancel>Cancel</button><button class="btn-primary" data-apply ${canApply ? '' : 'disabled'}>Apply import</button>`,
    onMount(ov, close) {
      $('[data-cancel]', ov).addEventListener('click', close);
      const applyBtn = $('[data-apply]', ov);
      if (applyBtn && canApply) applyBtn.addEventListener('click', async () => {
        applyBtn.disabled = true; applyBtn.textContent = 'Applying…';
        try {
          const r = await api.importData(module, csvText, false);
          toast(`Imported ${module}: ${r.summary.applied} applied (${r.summary.toInsert} new, ${r.summary.toUpdate} updated)`, 'success');
          close();
          if (state.route && state.route.name === module) route();
        } catch (e) { toast(e.message, 'error'); applyBtn.disabled = false; applyBtn.textContent = 'Apply import'; }
      });
    },
  });
}

// ==========================================================================
// Quick / detailed report modal
// ==========================================================================
let quickUploader = null;
async function openReportModal() {
  if (!CAN_CREATE.includes(state.user.role)) return;
  let outlets;
  try { outlets = await api.outlets(); }
  catch (e) { toast(e.message, 'error'); return; }
  const brandsGroups = {};
  outlets.forEach((o) => { (brandsGroups[o.brand_code] = brandsGroups[o.brand_code] || []).push(o); });
  const lastOutlet = store.get('lastOutlet', '');
  const optgroups = Object.entries(brandsGroups).map(([b, list]) => `<optgroup label="${esc(b)}">${list.map((o) => `<option value="${esc(o.code)}" ${o.code === lastOutlet ? 'selected' : ''}>${esc(o.code)}${o.name && o.name !== o.code ? ' · ' + esc(o.name) : ''}</option>`).join('')}</optgroup>`).join('');
  const isAdmin = ADMIN_ROLES.includes(state.user.role);
  const body = `
    <form id="q-form" novalidate>
    <div class="field"><label for="q-outlet">Outlet <span class="req-star">*</span></label>
      <input type="search" id="q-outlet-filter" class="select-filter" placeholder="Type to filter outlets…" aria-label="Filter outlets">
      <select id="q-outlet"><option value="">Select outlet…</option>${optgroups}</select></div>
    <div class="field"><span class="label">Department <span class="req-star">*</span></span>
      <div class="segmented" role="radiogroup" aria-label="Department">
        <button type="button" class="seg-btn big" role="radio" aria-checked="false" data-dept="IT">${svg(ICONS.monitor, 22)}<span>IT<small>POS, printer, network, CCTV</small></span></button>
        ${ME_ENABLED ? `<button type="button" class="seg-btn big" role="radio" aria-checked="false" data-dept="ME">${svg(ICONS.wrench, 22)}<span>Mechanical<small>AC, electrical, plumbing</small></span></button>` : ''}
      </div></div>
    <div class="field"><label for="q-cat">Category <span class="req-star">*</span></label><select id="q-cat" disabled><option value="">Choose a department first</option></select></div>
    <div id="q-event" hidden>
      <div class="field-row">
        <div class="field"><label for="q-sched">Event start</label><input type="datetime-local" id="q-sched"></div>
        <div class="field"><label for="q-sched-end">Event end</label><input type="datetime-local" id="q-sched-end"></div>
      </div>
      <div class="hint mb">For planned work (printer setup, on-site standby). An admin confirms it as “On Scheduled”.</div>
    </div>
    <div class="field"><label for="q-desc">What’s the problem? <span class="req-star">*</span></label><textarea id="q-desc" maxlength="5000" placeholder="e.g. POS terminal 2 stopped printing receipts after the power cut"></textarea><div class="hint char-hint" data-count="q-desc"></div></div>
    <div class="field"><span class="label">Urgency</span><div class="segmented seg-urg" id="q-urg" role="radiogroup" aria-label="Urgency">${URGENCIES.map((u) => `<button type="button" role="radio" aria-checked="${u === 'Medium'}" class="seg-btn urg-${u} ${u === 'Medium' ? 'active' : ''}" data-urg="${u}">${u}</button>`).join('')}</div>
      <div class="hint" id="q-urg-hint">${canSeeSla() ? `Medium: resolve within ${fmtMins(24 * 60)}.` : 'Medium: normal'}</div></div>
    <div class="field-row">
      <div class="field"><label for="q-reqname">Reported by <span class="req-star">*</span></label><input id="q-reqname" maxlength="120" value="${esc(state.user.username)}"></div>
      <div class="field"><label for="q-contact">WhatsApp for updates</label><input id="q-contact" maxlength="40" placeholder="08xx…" inputmode="tel" autocomplete="tel" value="${esc(store.get('lastContact', state.user.phone || ''))}"></div>
    </div>
    ${isAdmin ? `<div class="field"><label for="q-cemail">On behalf of (email, optional)</label><input id="q-cemail" type="email" maxlength="254" placeholder="requester@company.com" inputmode="email"><div class="hint">Lets that requester follow the ticket in “My Tickets”.</div></div>` : ''}
    <details class="more-details" id="q-extra">
      <summary>More details (optional)</summary>
      <div class="field"><label for="q-title">Short subject</label><input id="q-title" maxlength="200" placeholder="Defaults to the first line of the description"></div>
      <div class="field-row"><div class="field"><label for="q-loc">Location in outlet</label><input id="q-loc" maxlength="255" placeholder="e.g. front cashier"></div><div class="field"><label for="q-dev">Device / equipment</label><input id="q-dev" maxlength="255" placeholder="e.g. Epson TM-T82"></div></div>
      <div class="field"><label for="q-impact">Business impact</label><input id="q-impact" maxlength="255" placeholder="e.g. cannot take card payments"></div>
      <div class="field-row"><div class="field"><label for="q-occ">When it started</label><input type="datetime-local" id="q-occ"></div><div class="field"><label for="q-visit">Best time to visit</label><input id="q-visit" maxlength="255" placeholder="e.g. after 2pm"></div></div>
    </details>
    <div class="field mt"><span class="label">Photos / video</span>${uploadZoneHTML('q-up')}</div>
    <div class="form-alert" id="q-err" role="alert" hidden></div>
    <button type="submit" hidden></button>
    </form>`;
  const foot = `<button type="button" class="btn-ghost" data-cancel>Cancel</button><button type="button" class="btn-primary" id="q-submit">${svg(ICONS.zap, 15)} Submit report</button>`;
  openModal({
    title: 'Report an issue', bodyHTML: body, footHTML: foot, size: 'lg',
    onClose: () => { if (quickUploader) { quickUploader.discard(); quickUploader = null; } },
    onMount(ov, close) {
      quickUploader = new Uploader($('#q-up', ov), $('#q-up-list', ov));
      wireCharCounters(ov);
      wireSelectFilter($('#q-outlet-filter', ov), $('#q-outlet', ov));
      let dept = '';
      $$('[data-dept]', ov).forEach((b) => b.addEventListener('click', async () => {
        dept = b.dataset.dept;
        $$('[data-dept]', ov).forEach((x) => { x.classList.toggle('active', x === b); x.setAttribute('aria-checked', String(x === b)); });
        const sel = $('#q-cat', ov); sel.disabled = true; sel.innerHTML = '<option>Loading…</option>';
        try {
          const cats = await api.categories(dept);
          sel.innerHTML = '<option value="">Select category…</option>' + cats.map((c) => `<option value="${esc(c.name)}">${esc(c.name)}</option>`).join('');
          sel.disabled = false; sel.focus();
        } catch (e) { sel.innerHTML = '<option value="">Failed to load. Pick the department again</option>'; }
        $('#q-event', ov).hidden = true;
      }));
      if (!ME_ENABLED) $('[data-dept="IT"]', ov).click();
      $('#q-cat', ov).addEventListener('change', (e) => { $('#q-event', ov).hidden = e.target.value !== 'Event'; });
      const URG_HINT = { Low: 'minor, can wait', Medium: 'normal', High: 'hurting operations', Critical: 'operations stopped' };
      const SLA = { Critical: 120, High: 240, Medium: 1440, Low: 4320 };
      let urg = 'Medium';
      $$('[data-urg]', ov).forEach((b) => b.addEventListener('click', () => {
        urg = b.dataset.urg;
        $$('[data-urg]', ov).forEach((x) => { x.classList.toggle('active', x === b); x.setAttribute('aria-checked', String(x === b)); });
        $('#q-urg-hint', ov).textContent = canSeeSla() ? `${urg}: ${URG_HINT[urg]}; target resolution ${fmtMins(SLA[urg])}.` : `${urg}: ${URG_HINT[urg]}`;
      }));
      $('[data-cancel]', ov).addEventListener('click', close);
      const submit = $('#q-submit', ov);
      const errBoxEl = $('#q-err', ov);
      const send = async () => {
        if (submit.disabled) return;
        const val = (id) => { const el = $(id, ov); return el ? el.value.trim() : ''; };
        const fail = (msg, el) => { errBoxEl.textContent = msg; errBoxEl.hidden = false; if (el) el.focus(); };
        errBoxEl.hidden = true;
        const outlet = $('#q-outlet', ov).value, cat = $('#q-cat', ov).value, desc = val('#q-desc');
        if (!outlet) return fail('Select the outlet.', $('#q-outlet', ov));
        if (!dept) return fail(ME_ENABLED ? 'Choose IT or Mechanical.' : 'Choose a department.', $('[data-dept]', ov));
        if (!cat) return fail('Select a category.', $('#q-cat', ov));
        if (!desc) return fail('Describe the problem.', $('#q-desc', ov));
        if (!val('#q-reqname')) return fail('Enter who is reporting.', $('#q-reqname', ov));
        const contact = val('#q-contact');
        if (contact && !/^\+?[\d\s().-]{8,20}$/.test(contact)) return fail('That WhatsApp number does not look right.', $('#q-contact', ov));
        const s1 = val('#q-sched'), s2 = val('#q-sched-end');
        if (s1 && s2 && s2 < s1) return fail('The event end must be after its start.', $('#q-sched-end', ov));
        if (quickUploader.uploading()) return fail('Wait for the uploads to finish.');
        submit.disabled = true; submit.textContent = 'Submitting…';
        const payload = {
          requestor_name: val('#q-reqname'), customer_name: val('#q-reqname'),
          department: dept, outlet_code: outlet, category: cat, description: desc, urgency: urg,
          contact_number: contact, report_mode: $('#q-extra', ov).open ? 'detailed' : 'quick',
          attachmentIds: quickUploader.ids(),
          title: val('#q-title'), location_detail: val('#q-loc'), device_equipment: val('#q-dev'),
          business_impact: val('#q-impact'), occurrence_at: val('#q-occ'), preferred_visit_time: val('#q-visit'),
          scheduled_at: cat === 'Event' ? s1 : '', scheduled_end: cat === 'Event' ? s2 : '',
        };
        if (isAdmin) payload.customer_email = val('#q-cemail');
        try {
          const t = await api.createTicket(payload);
          store.set('lastOutlet', outlet);
          if (contact) store.set('lastContact', contact);
          quickUploader = null; // attachments now belong to the ticket
          toast(`Ticket ${t.ticket_number} created`, 'success');
          close();
          navigate('/tickets/' + t.id);
        } catch (e) {
          fail(e.status === 409 ? 'Looks like you just sent this. Check your ticket list.' : e.message);
          submit.disabled = false; submit.innerHTML = `${svg(ICONS.zap, 15)} Submit report`;
        }
      };
      submit.addEventListener('click', send);
      $('#q-form', ov).addEventListener('submit', (e) => { e.preventDefault(); send(); });
    },
  });
}

// ==========================================================================
// Shared UI bits
// ==========================================================================
function emptyBox(icon, title, sub) {
  return `<div class="empty"><div class="empty-icon">${svg(ICONS[icon] || ICONS.ticket, 28)}</div><h3>${esc(title)}</h3><p>${esc(sub)}</p></div>`;
}
// Error state with an optional retry button (wired by delegation below).
const retryHandlers = new Map();
let retrySeq = 0;
function errBox(e, retry) {
  let attr = '';
  if (retry) { const id = 'r' + (++retrySeq); retryHandlers.set(id, retry); attr = ` data-retry="${id}"`; }
  const offline = e && e.status === 0;
  return `<div class="empty"><div class="empty-icon danger">${svg(offline ? ICONS.slash : ICONS.alertTriangle, 28)}</div>
    <h3>${offline ? 'Connection problem' : 'Something went wrong'}</h3><p>${esc((e && e.message) || 'Please try again')}</p>
    ${retry ? `<button type="button" class="btn-outline"${attr}>${svg(ICONS.refresh, 15)} Try again</button>` : ''}</div>`;
}
document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('[data-retry]');
  if (!b) return;
  const fn = retryHandlers.get(b.dataset.retry);
  retryHandlers.delete(b.dataset.retry);
  if (fn) fn();
});
function skeletonRows() { return Array(5).fill('<div class="skeleton skeleton-row"></div>').join(''); }
// In-app links are handled by one delegated listener (see init); kept for callers.
function wireNavLinks() {}
// "123 / 5000" counters under textareas with data-count="<id>".
function wireCharCounters(root) {
  $$('[data-count]', root).forEach((hint) => {
    const el = $('#' + hint.dataset.count, root);
    if (!el || !el.maxLength || el.maxLength < 0) return;
    const upd = () => {
      const n = el.value.length;
      hint.textContent = n > el.maxLength * 0.8 ? `${n} / ${el.maxLength}` : '';
      hint.classList.toggle('warn', n >= el.maxLength);
    };
    el.addEventListener('input', upd); upd();
  });
}
// Filter a long <select> by typing (keeps optgroups tidy).
function wireSelectFilter(input, select) {
  if (!input || !select) return;
  input.addEventListener('input', () => {
    const qv = input.value.trim().toLowerCase();
    let firstMatch = null;
    $$('option', select).forEach((o) => {
      if (!o.value) return;
      const hit = !qv || o.textContent.toLowerCase().includes(qv);
      o.hidden = !hit; o.disabled = !hit;
      if (hit && !firstMatch) firstMatch = o;
    });
    $$('optgroup', select).forEach((g) => { g.hidden = !$$('option', g).some((o) => !o.hidden); });
    if (qv && firstMatch && (select.selectedOptions[0] || {}).hidden !== false) select.value = firstMatch.value;
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); select.focus(); } });
}

// ==========================================================================
// Global wiring + init
// ==========================================================================
async function doLogout() {
  try { await api.logout(); } catch (_) {}
  state.user = null; state.meta.outlets = null;
  closeAllModals();
  stopAutoRefresh();
  navigate('/login');
  toast('Signed out', 'info');
}
function openChangePasswordModal() {
  const rules = [
    ['len', '10+ characters', (p) => p.length >= 10],
    ['case', 'Upper & lower case', (p) => /[a-z]/.test(p) && /[A-Z]/.test(p)],
    ['num', 'A number', (p) => /\d/.test(p)],
    ['sym', 'A symbol (e.g. ! @ #)', (p) => /[^A-Za-z0-9]/.test(p)],
  ];
  openModal({
    title: 'Change password',
    size: 'sm',
    bodyHTML: `
      <form id="form-change-pw" novalidate>
        <input type="text" autocomplete="username" value="${esc(state.user.email)}" hidden>
        <div class="field"><label for="pw-old">Current password</label>${pwInput('pw-old', 'autocomplete="current-password" autofocus')}</div>
        <div class="field"><label for="pw-new">New password</label>${pwInput('pw-new', 'autocomplete="new-password"')}
          <ul class="checklist" id="pw-rules">${rules.map(([k, l]) => `<li class="ck" data-rule="${k}">${svg(ICONS.checkCircle2, 14)} ${esc(l)}</li>`).join('')}</ul></div>
        <div class="field"><label for="pw-confirm">Confirm new password</label>${pwInput('pw-confirm', 'autocomplete="new-password"')}</div>
        <p class="hint">Other devices will be signed out.</p>
        <div class="form-alert" id="pw-err" role="alert" hidden></div>
        <button type="submit" hidden></button>
      </form>`,
    footHTML: `<button type="button" class="btn-ghost" data-cancel>Cancel</button><button type="button" class="btn-primary" id="btn-save-pw">Update password</button>`,
    onMount(ov, close) {
      $('[data-cancel]', ov).addEventListener('click', close);
      const nw = $('#pw-new', ov);
      nw.addEventListener('input', () => rules.forEach(([k, , test]) => $(`[data-rule="${k}"]`, ov).classList.toggle('met', test(nw.value))));
      const err = $('#pw-err', ov);
      const btn = $('#btn-save-pw', ov);
      const save = async () => {
        const oldPassword = $('#pw-old', ov).value;
        const newPassword = nw.value;
        const confirmPassword = $('#pw-confirm', ov).value;
        const fail = (m) => { err.textContent = m; err.hidden = false; };
        err.hidden = true;
        if (!oldPassword || !newPassword || !confirmPassword) return fail('Fill in all three fields.');
        if (!rules.every(([, , test]) => test(newPassword))) return fail('The new password does not meet all the rules.');
        if (newPassword !== confirmPassword) return fail('The confirmation does not match.');
        if (btn.disabled) return;
        btn.disabled = true; btn.textContent = 'Updating…';
        try {
          await api.changePassword({ oldPassword, newPassword, confirmPassword });
          toast('Password changed. Other devices were signed out', 'success');
          close();
        } catch (e) {
          fail(e.message || 'Failed to change password');
          btn.disabled = false; btn.textContent = 'Update password';
        }
      };
      btn.addEventListener('click', save);
      $('#form-change-pw', ov).addEventListener('submit', (e) => { e.preventDefault(); save(); });
    },
  });
}

function applyTheme(light) {
  document.body.classList.toggle('light', light);
  document.documentElement.style.colorScheme = light ? 'light' : 'dark';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', light ? '#f5f7fb' : '#0b1020');
  const sun = $('.ico-sun'), moon = $('.ico-moon');
  if (sun) sun.hidden = !light;
  if (moon) moon.hidden = light;
}
function initTheme() {
  const saved = store.get('theme');
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  applyTheme(saved ? saved === 'light' : !mq.matches);
  // Follow the OS switch until the user picks explicitly.
  if (mq.addEventListener) mq.addEventListener('change', (e) => { if (!store.get('theme')) applyTheme(!e.matches); });
}

document.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  $('#btn-hamburger').addEventListener('click', openDrawer);
  $('#drawer-close').addEventListener('click', closeDrawer);
  $('#drawer-overlay').addEventListener('click', closeDrawer);
  $('#btn-logout').addEventListener('click', doLogout);
  $('#btn-change-password').addEventListener('click', () => { closeDrawer(); openChangePasswordModal(); });
  $('#btn-report-quick').addEventListener('click', () => openReportModal());
  $('#btn-theme').addEventListener('click', () => {
    const light = !document.body.classList.contains('light');
    store.set('theme', light ? 'light' : 'dark');
    applyTheme(light);
  });
  // One delegated handler for every in-app link (plain clicks only).
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[data-nav]');
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    closeDrawer();
    navigate(a.getAttribute('href'));
  });
  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target.tagName || '')) || e.target.isContentEditable;
    if (e.key === 'Escape' && !$('#modal-root .modal-overlay') && $('#app-shell').classList.contains('drawer-open')) closeDrawer();
    if (typing || e.ctrlKey || e.metaKey || e.altKey || $('#modal-root .modal-overlay') || !state.user) return;
    if (e.key === '/' && $('#f-search, #u-search, #cat-search, #loc-search, #sch-search')) {
      e.preventDefault(); $('#f-search, #u-search, #cat-search, #loc-search, #sch-search').focus();
    } else if (e.key === 'n' && CAN_CREATE.includes(state.user.role)) {
      e.preventDefault(); openReportModal();
    }
  });
  // Password show/hide toggle (delegated — auth screens and modals).
  document.addEventListener('click', (e) => {
    const btn = e.target.closest && e.target.closest('.pw-toggle'); if (!btn) return;
    e.preventDefault();
    const inp = $('input', btn.parentElement); if (!inp) return;
    const show = inp.type === 'password';
    inp.type = show ? 'text' : 'password';
    btn.innerHTML = svg(show ? EYE_OFF_ICON : EYE_ICON, 18);
    btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    inp.focus();
  });
  // Connectivity feedback for on-prem Wi-Fi drops.
  window.addEventListener('offline', () => { document.body.classList.add('is-offline'); toast('You are offline. Changes will fail until the network is back', 'error'); });
  window.addEventListener('online', () => { document.body.classList.remove('is-offline'); toast('Back online', 'success'); });
  // Returning to the tab refreshes the dashboard right away.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.user && state.route.name === 'dashboard') renderDashboard({ silent: true });
  });

  try { state.user = await api.me(); } catch (_) { state.user = null; }
  const loader = $('#app-loading');
  loader.classList.add('fade-out');
  setTimeout(() => { loader.hidden = true; }, 300);
  if (state.user) boot();
  route();
});
