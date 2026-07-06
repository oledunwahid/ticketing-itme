# Bug Log — OmniDesk / Ticketing IT-ME

> These are **pre-existing** bugs observed while mapping the code for the refactor.
> **Policy:** documented only. NOT fixed during the structure refactor (per project rules),
> unless a refactor step directly touches the code and a fix is required for stability.
>
> Bug classes:
> - **A = existing bug** (present before refactor) → do not fix now.
> - **B = refactor-introduced** → must be fixed immediately (none so far).

---

## A1 — "Submit not inserting correctly" (ticket create) — ✅ FIXED

- **Status:** **FIXED** (functional bug-fix phase, after the refactor).
- **Symptom (reported):** Creating a ticket via the "Report an issue" modal sometimes fails to insert — the user gets an error toast instead of a created ticket.

### Root cause (confirmed with a reproduction)
The category `<select>` in the create-ticket form rendered its options **without a `value` attribute**:

```js
// public/app.js — BEFORE
cats.map((c) => `<option>${esc(c.name)}</option>`)
```

For an `<option>` with no `value` attribute, the browser's `option.value` returns the element's
**text with ASCII whitespace stripped and collapsed** (per the HTML spec) — NOT the exact stored name.
So the frontend submitted a *whitespace-normalized* category name. The backend validates the category
with an **exact** match:

```sql
SELECT 1 FROM categories WHERE department_code = ? AND name = ?
```

Any category whose stored name contains leading/trailing or **double** internal whitespace →
submitted value ≠ stored name → backend returns **400 `Category "…" does not belong to <DEPT>"`** →
the ticket is never inserted. (The outlet dropdown never had this problem because it already used
`value="${esc(o.code)}"`.)

This was invisible to API/curl tests because those send the exact name; it only manifests through the
real DOM `<select>`. It became easy to trigger once the "Master Category" admin feature let admins
create categories with arbitrary names.

### Reproduction (before fix)
Category stored as `"ZZ  Double"` (two spaces) →
- browser `option.value` → `"ZZ Double"` (one space) → `POST /api/tickets` → **400 "Category "ZZ Double" does not belong to IT"** (no insert)
- exact `"ZZ  Double"` → **201 Created** (inserts fine)

### The fix (frontend only — 1 line)
```js
// public/app.js:1463 — AFTER
cats.map((c) => `<option value="${esc(c.name)}">${esc(c.name)}</option>`)
```
The explicit `value` attribute makes `option.value` return the **exact** stored name (the browser
returns attribute values verbatim), so it always matches the backend. Now consistent with the outlet
dropdown pattern.

### Files changed
- `public/app.js` (line 1463 — category option `value` attribute). **No backend, schema, RBAC, or
  business-logic change.** `POST /api/tickets` was left exactly as-is.

### Before / after behavior
| | Before | After |
|--|--------|-------|
| Category with clean single-space name (e.g. "POS System") | inserts (201) | inserts (201) — unchanged |
| Category with double/edge whitespace | **400, no insert** | **201, inserts** |
| Invalid payload (missing dept/category) | 400 | 400 (unchanged) |
| Rapid duplicate submit | 409 guard | 409 guard (unchanged) |

### Verification
- `node --check public/app.js` OK; server boots; login OK.
- Create ticket → 201, appears in requestor's list, detail opens, ticket number generated
  (`IT-YYYY-NNNN`), department/category/outlet/brand saved correctly.
- Invalid payload → still 400; double-submit → still 409; attachments unchanged.
- Requestor sees own tickets; admin/superadmin visibility unchanged (all verified via the standard smoke suite).
- Debug/test tickets created during investigation were deleted afterwards; `tickets` row count restored
  to its baseline. (Ticket-number sequence advanced by a few — expected; sequences never roll back.)

### Note on the same latent pattern elsewhere (intentionally NOT changed)
Report/schedule **filter** dropdowns (`public/app.js:898,956,957,960,961`) also use value-less
`<option>`s, but they carry whitespace-clean constants (IT/ME, brand codes, STATUSES, URGENCIES) and
feed query-param **filters**, not the insert path — so they are not defective in practice and are out
of scope for this fix.

### ⚠️ Follow-up: the category-value fix was necessary but NOT the primary cause
Real-browser testing surfaced the actual blocker — a JS crash in the modal (A3 below). The category
`value` fix is still correct/needed, but A3 was why submit did nothing in the browser.

---

## A3 — Report modal crashes on open (submit button dead) — ✅ FIXED

- **Status:** **FIXED.**
- **Symptom (from real browser console):**
  `Uncaught (in promise) ReferenceError: Cannot access 'close' before initialization`
  `at onMount (app.js:1469) → openModal (app.js:201) → openReportModal (app.js:1454)`
  The modal opens but the JS crashes mid-`onMount`, so the **submit listener is never attached** → the
  Submit button does nothing (no `POST /api/tickets` ever fires).

### Root cause (Temporal Dead Zone)
`openReportModal` (and `openAssignModal`) do:
```js
const { overlay, close } = openModal({ onMount(ov) { … close … } });
```
`openModal` invokes `onMount(overlay, close)` **synchronously, before it returns** (`app.js:201`), i.e.
before the outer `const { …, close }` has been initialized. The `onMount(ov)` signature did **not**
capture the `close` argument, so `close` inside `onMount` resolved to the outer `const`, which was
still in its **temporal dead zone** → `ReferenceError`. The crash fired at the first *synchronous* read
of `close` — `$('[data-cancel]', ov).addEventListener('click', close)` — which is **before** the submit
handler is wired, so the submit button never got a listener.

(Other modals — `formModal`, `openReauth` — reference `close` only inside deferred arrow callbacks
`() => { close() }`, so they read it later when it's already initialized; they were **not** affected.)

Reproduced in isolation (Node) with the same pattern → identical `ReferenceError: Cannot access 'close'
before initialization`; with the fix → no error.

### The fix (frontend only, 2 lines)
Give `onMount` the `close` parameter that `openModal` already passes, so it uses the real function
instead of the TDZ binding:
```js
// public/app.js:1456 (report modal)   onMount(ov)        -> onMount(ov, close)
// public/app.js:860  (assign modal)   async onMount(ov)  -> async onMount(ov, close)
```
No change to `openModal`, no new modal flow, no backend change.

### Files changed
- `public/app.js` (2 lines: `openReportModal.onMount`, `openAssignModal.onMount`).

---

## A4 — Upload dropzone opens the file picker twice — ✅ FIXED

- **Status:** **FIXED.**
- **Symptom:** Clicking the photo/video dropzone opens the OS file picker **twice**.

### Root cause
The file input is an **invisible overlay covering the whole zone**
(`style.css:283` → `.upload-zone input[type=file] { position:absolute; inset:0; opacity:0 }`).
A click in the zone therefore (1) lands on the input → the browser opens the picker **natively**, then
(2) bubbles to the `.upload-zone` div whose handler calls `input.click()` → opens the picker **again**.

### The fix (frontend only)
In the zone click handler (`Uploader` constructor), skip the programmatic `input.click()` when the click
already landed on the input (its native behavior already opened the picker):
```js
zone.addEventListener('click', (e) => {
  if (e.target.closest('.preview-card')) return;
  if (e.target === input) return;   // ← added: input's native click already opens the picker
  input.click();
});
```
Result: the picker opens exactly once; the `change` handler (added once in the constructor) fires once
per selection → one `/api/attachments/upload` per file. Drag/drop and validation are unchanged.

### Files changed
- `public/app.js` (`Uploader` constructor zone click handler).

---

## Browser verification required (owner to confirm in the real UI)
The automation browser was not reachable from this environment, so A3/A4 were proven by root-cause
analysis + a Node reproduction of the exact `ReferenceError`, and the fixes confirmed present in the
live-served `app.js`. Because `public/app.js` is served statically, the fixes are already live —
**hard-refresh (Ctrl/Cmd+Shift+R)** the browser, then run the verification checklist in the final report.

---

## A2 — `tickets.db` is git-tracked despite being `.gitignore`d

- **Symptom:** `git status` shows `M tickets.db`; the DB file was committed before it was added to `.gitignore`.
- **Files:** `.gitignore` (correct), repo index (stale).
- **Impact:** Local dev data churns the repo; risk of committing data / merge conflicts on a binary.
- **Fix (safe, does NOT delete data — flagged, not auto-run):**
  ```
  git rm --cached tickets.db
  git commit -m "Stop tracking local SQLite db (already in .gitignore)"
  ```
  `--cached` removes it from the index only; the working-tree file and its data stay.
- **Status:** Recommendation only — not executed (a git-tracking change beyond the code refactor).

---

## Phase 2.3 review note (meta / reference routes)

No **new** existing bugs were found while extracting the brands/outlets/departments/categories
routes. Behavior reviewed and confirmed intentional (not bugs):
- `GET /api/meta/brands` / `GET /api/meta/outlets` / `GET /api/meta/categories` filter `active = 1`
  (picker views), while the management endpoints (`GET /api/outlets`, `GET /api/categories`) return
  all rows — this is by design.
- A1 ("submit not inserting") is unaffected by this phase; ticket routes were not touched.

## Phase 2.4A review note (ticket helper extraction)

No new existing bugs found while extracting `logActivity`, `nextTicketNumber`, `getVisibleTicket`,
`validateTransition`. Ticket routes were not touched, so A1 ("submit not inserting") is unchanged and
still documented-only.

## Phase 2.4B1 review note (read-only ticket routes)

No new existing bugs found while moving `GET /api/tickets`, `GET /api/tickets/:id`, and
`GET /api/dashboard` into the tickets router. Ticket mutation routes were not touched, so A1
("submit not inserting") is unchanged and still documented-only.

## Phase 2.4B2 review note (ticket mutation routes)

Moved `recommend`, `comments`, `assign`, `PATCH`, and `POST /api/tickets` into the tickets router.
**A1 ("submit not inserting") was deliberately preserved** — the POST route was moved byte-for-byte
(same validation, same `recentCreates` duplicate-guard, same INSERT). It was neither fixed nor worsened.

During testing, a malformed-JSON curl payload produced a 500 via `body-parser` (global error handler),
which looked alarming but is standard Express behavior for invalid request bodies — reproducible on the
original inline routes too. Re-tested with valid JSON: correct 404/400 responses. **Not a bug.**

## Phase 2.5A review note (technician routes)

No new existing bugs found while moving the 5 `/api/technicians*` routes and `canManageTechnician`
into `src/routes/technicians.routes.js`. Users/reports/attachments untouched; A1 unaffected.

## Phase 2.5B/C/D + 2.6 review note (users / reports / attachments + cleanup)

No new existing bugs found while extracting users, reports, and attachments routes, nor during the
app.js cleanup. A1 ("submit not inserting") remains untouched and documented-only. Backend route
modularization is now complete; app.js is a 63-line bootstrap.

Note on the attachments 500-on-INSERT-error path: `POST /api/attachments/upload` and `upload-chunk`
still `res.status(500).json({ error: e.message })` on a DB failure — this is **pre-existing behavior**,
moved verbatim, not a refactor change.

## Refactor-introduced bugs (class B)

_None (through Phase 2.6 — backend complete). Every smoke check matched baseline at every step._
