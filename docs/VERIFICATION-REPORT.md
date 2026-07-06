# Verification Report — Refactor (session 1)

Every step below was verified with the same smoke suite against a booted server on port 3999.
**No endpoint URL, response shape, DB table, or business logic was changed** — only *where the code lives*.

## Smoke suite (run after every step)
`node --check` on all JS (incl. new `src/**`) → boot → then:

| Check | Baseline | After each step |
|-------|:--------:|:---------------:|
| `GET /` | 200 | 200 |
| `GET /app.js` | 200 | 200 |
| `GET /api/auth/me` (no cookie) | 401 | 401 |
| `POST /api/auth/login` (superadmin) | 200 + user JSON | 200 + identical JSON |
| `GET /api/auth/me` (cookie) | 200 | 200 |
| `GET /api/tickets` | 200 | 200 |
| `GET /api/dashboard` | 200 | 200 |
| `GET /api/users` | 403¹ | 403 |
| `GET /api/meta/categories?department=IT` | 200 | 200 |
| `GET /api/technicians` | 403¹ | 403 |
| `POST /api/auth/logout` | 200 | 200 |

¹ The live `superadmin@union.com` row is role `Requestor` in the current DB, so these two legitimately return 403. That is the *baseline* and it stayed identical — not a regression.

---

## Steps completed & verified

### Phase 1 — config extraction
| Step | Files changed | Moved | NOT changed | Result |
|------|---------------|-------|-------------|:------:|
| 1.2 env | +`src/config/env.js`, `app.js` | `PORT`, `JWT_SECRET`, prod JWT guard | guard still uses real `process.env.NODE_ENV`; `PROJECT_ROOT` added but paths in app.js untouched | ✅ green |
| 1.3 constants | +`src/config/constants.js`, `app.js` | `STATUSES`, `URGENCIES`, `DEPARTMENTS`, `ADMIN_ROLES` (verbatim) | values identical | ✅ green |

### Phase 2 — shared modules + first route group
| Step | Files changed | Moved | NOT changed | Result |
|------|---------------|-------|-------------|:------:|
| 2.1 auth middleware | +`src/middleware/auth.js`, `app.js` | `rateLimit`(+`rateBuckets`), `signToken`, `setSessionCookie`, `requireAuth`, `requireRole` | logic byte-for-byte; cookie flags, sliding-window, absolute-exp all preserved | ✅ green |
| 2.2 RBAC/scope | +`src/utils/permissions.js`, `app.js` | `deptForRole`, `isAdmin`, `isTechnician`, `adminScopeForTicket`, `canClose`, `getUserScope`, `buildTicketScope` | SQL, clause-building, param order unchanged | ✅ green |
| 2.x auth routes | +`src/routes/auth.routes.js`, `app.js` | `/api/auth/register`, `/login`, `/logout`, `/me` handlers | mounted at `/` → full paths preserved; middleware order preserved | ✅ green (login+me+logout tested) |

**`app.js`: 2166 → 1831 lines.** `logActivity` intentionally left in `app.js` (it belongs to the ticket-domain cluster, moved in a later step).

### Intentionally NOT changed this session
- `database.js` (connection/migrations/seeds) — untouched; DB path stays anchored to project root there.
- All meta/ticket/user/schedule/report/attachment routes — still inline in `app.js`, working.
- `public/**` frontend — untouched (Phase 3+).
- `tickets.db` data & schema — untouched (runtime login writes only).
- The `git rm --cached tickets.db` recommendation — flagged in BUG-LOG A2, not executed.

### Refactor-introduced (class B) bugs
**None.** Every smoke check matched baseline at every step.

---

---

# Verification Report — Phase 2.3 (meta / reference routes)

**Scope:** extract brands, outlets, departments, categories route groups into `src/routes/*`.
**Design decision:** router files only — **no controller/repository layers** were created. These
handlers are simple and self-contained; adding those layers would be over-engineering and add error
surface for no safety benefit (explicitly discouraged by the phase brief). Each router uses full
`/api/...` paths and is mounted with `app.use(...)` at the same position the routes previously held,
so URL matching and middleware order are unchanged.

**Dependencies of the moved routes:** `requireAuth`, `requireRole` (already in `src/middleware/auth.js`),
`db` (`./database`), `DEPARTMENTS` (`src/config/constants.js`). **No app.js-local helper was needed**,
so nothing had to move alongside them and nothing was left dangling.

## Per-group result (smoke check ran after EACH move)

| Step | New file | Routes moved | Smoke result |
|------|----------|--------------|:------:|
| brands | `src/routes/brands.routes.js` | `GET /api/meta/brands` | ✅ green · shape `[{code,name}]` identical |
| outlets | `src/routes/outlets.routes.js` | `GET /api/meta/outlets`, `GET/POST/PATCH/DELETE /api/outlets` | ✅ green · meta shape identical · `GET /api/outlets`→403 (RBAC preserved) |
| departments | `src/routes/departments.routes.js` | `GET /api/meta/departments` | ✅ green · shape `[{code:"IT"},{code:"ME"}]` identical |
| categories | `src/routes/categories.routes.js` | `GET /api/meta/categories`, `GET/POST/PATCH/DELETE /api/categories` | ✅ green · meta shape identical · `GET /api/categories`→403 (RBAC preserved) |

Full smoke suite (11 checks incl. login/me/dashboard/tickets) matched baseline after every step.

## Routes deliberately NOT moved
- **All ticket routes** (`/api/tickets*`) — untouched; confirmed still inline in `app.js`
  (`grep` shows `app.post/get/patch("/api/tickets...` at lines 116/255/310/368/640) and
  `GET /api/tickets` returned **200** after the categories move.
- users / schedules / reports / attachments / dashboard — untouched (later phases).
- `nextTicketNumber`, `recentCreates`, `logActivity` and all ticket helpers — untouched.

## Confirmation
- **Ticket routes were not touched** during Phase 2.3. ✅
- No controller/repository files were created (kept the refactor small, as requested).
- Frontend (`public/**`) untouched; API contracts the category modal / outlet pickers rely on
  verified byte-identical via curl. (Browser-driven UI check was unavailable — Chrome extension
  not connected — but no frontend code changed, so behavior is unchanged by construction.)
- **`app.js`: 1831 → 1526 lines.** No `class B` (refactor-introduced) bug observed.

---

# Verification Report — Phase 2.4A (ticket helper extraction)

**Scope:** extract the four ticket helper functions from `app.js` into dedicated modules.
**Ticket routes were NOT moved** — only the helpers they call. No schema change was needed
(so no schema question was raised). No controller/repository layers added (kept small).

## Dependency map (confirmed before moving)

| Helper | Call sites (app.js, pre-move) | Depends on | New file |
|--------|-------------------------------|-----------|----------|
| `logActivity(ticketId, actor, action, detail)` | 4 (226, 522, 614, 694) | `db` | `src/services/auditLog.service.js` |
| `nextTicketNumber(department)` | 1 (184) | `db` | `src/utils/ticketNumber.js` |
| `getVisibleTicket(user, id)` | 6 (312, 370, 541, 567, 642, 1483) | `db`, `buildTicketScope` (permissions) | `src/services/tickets.service.js` |
| `validateTransition(ticket, next, body, user)` | 1 (415) | `STATUSES` (constants), `isAdmin` (permissions) — **pure, no db** | `src/utils/statusTransition.js` |

All dependencies were already modular (`./database`, `src/utils/permissions.js`, `src/config/constants.js`),
so each helper moved cleanly with no code left behind and no dangling reference.

## Per-helper result (smoke check ran after EACH extraction)

| Step | New file | app.js change | Smoke result |
|------|----------|---------------|:------:|
| logActivity | `src/services/auditLog.service.js` | def → `require` | ✅ green |
| nextTicketNumber | `src/utils/ticketNumber.js` | def → `require` | ✅ green |
| getVisibleTicket | `src/services/tickets.service.js` | def → `require` | ✅ green + detail check |
| validateTransition | `src/utils/statusTransition.js` | def → `require` | ✅ green |

Full 11-check smoke suite matched baseline after every step.

## Behavior-unchanged verification
- **Ticket number format** — code moved byte-for-byte: `"${department}-${year}-${seq.padStart(4,'0')}"`. Unchanged.
- **Activity log** — same INSERT into `ticket_activity_logs`, same null-actor→"System" fallback. Unchanged.
- **Ticket visibility** — `getVisibleTicket` still applies `buildTicketScope`; verified live: scoped list returns `[]` (correct array shape) for the Requestor account, and a non-visible id (`/api/tickets/99999999`) → **404**. Unchanged.
- **Status transition validation** — all rules moved verbatim (STATUSES check, Resolved/Closed note, Cancelled reason, On Progress needs technician, Closed-reopen needs admin+reason). Unchanged.
- **Permission restrictions** — `/api/users` and `/api/technicians` still 403; `/api/tickets`/`/api/dashboard` still 200. Unchanged.

## Routes deliberately NOT moved
- **All ticket routes** (`/api/tickets`, `/api/tickets/:id`, `PATCH`, `/comments`, and the `:id/recommend`, `:id/assign` handlers) — still inline. Confirmed via grep: `app.post/get/patch("/api/tickets...` at lines 92/231/280/314/586 (+ others). `GET /api/tickets` → 200 after the final extraction.
- users / schedules / reports / attachments / dashboard — untouched.
- `recentCreates` double-submit guard, and the ticket route bodies — untouched.

## Confirmation
- **Ticket routes remain inline** (not moved). ✅ Awaiting approval for Phase 2.4B.
- Frontend (`public/**`) untouched. DB schema & data untouched (no schema change required).
- A1 "submit not inserting" left documented-only (not touched).
- **No `class B` (refactor-introduced) bug** — every smoke check matched baseline.
- **`app.js`: 1526 → 1472 lines.**

---

# Verification Report — Phase 2.4B1 (read-only ticket routes)

**Scope:** move ONLY read-only ticket routes into `src/routes/tickets.routes.js`. Mutation routes
stay inline. Router mounted at "/" so full paths are preserved; it holds only GET routes.

## Route classification (all ticket-area routes inline before this phase)

| Route | Class | This phase |
|-------|-------|:----------:|
| `GET /api/tickets` | read-only (scoped list) | ✅ moved |
| `GET /api/tickets/:id` | read-only (scoped detail bundle) | ✅ moved |
| `GET /api/dashboard` | read-only (scoped ticket aggregates) | ✅ moved |
| `GET /api/tickets/:id/recommend` | read-only but assignment-coupled | ❌ kept inline (not in approved step list) |
| `POST /api/tickets` | mutation (create) | ❌ kept inline |
| `PATCH /api/tickets/:id` | mutation (update/status) | ❌ kept inline |
| `POST /api/tickets/:id/assign` | mutation (assign) | ❌ kept inline |
| `POST /api/tickets/:id/comments` | mutation (comment) | ❌ kept inline |
| `/api/technicians*`, `/api/reports/*`, `/api/users*`, `/api/attachments*` | out of ticket scope | ❌ kept inline (Phase 2.5) |

## Dependencies mapped & wired into the router
`express`, `db` (`../../database`), `requireAuth` (`../middleware/auth`),
`buildTicketScope` + `isAdmin` + `deptForRole` (`../utils/permissions`),
`getVisibleTicket` (`../services/tickets.service`), `DEPARTMENTS` (`../config/constants`),
`OPEN_ASSIGNED_STATUSES` (`../../services/recommend`). All already modular — no code left behind.

## Per-route result (smoke check after EACH move)

| Step | Route moved | Smoke result |
|------|-------------|:------:|
| 1 | `GET /api/tickets` | ✅ green · list returns `[]` (correct array shape) · `?status=New` → 200 |
| 2 | `GET /api/tickets/:id` | ✅ green · non-visible id → **404** with exact message · `:id/recommend` still 403 (not shadowed) |
| 3 | `GET /api/dashboard` | ✅ green · response keys identical: `role,totals,avg_resolution_hours,byStatus,byUrgency,byDept,byBrand,byOutlet,topCategories,workload`; `totals={total,open,unassigned,waiting}`; arrays preserved |

Full 11-check smoke suite matched baseline after every step.

## Behavior-unchanged verification
- **Requestor visibility** — scoped list returns `[]`; non-visible detail → 404. Unchanged.
- **RBAC** — `/api/users`, `/api/technicians` still 403; `/api/tickets/:id/recommend` still 403 for Requestor (proves it's still the inline admin-gated route, not shadowed by the router's `:id`). Unchanged.
- **Empty list shape** — `[]` (array). **404 behavior** — same status + message. **403 behavior** — unchanged.
- **Dashboard** — byte-identical top-level shape and sub-shapes.
- **Route order / no shadowing** — router's `GET /api/tickets/:id` does not intercept `/api/tickets/:id/recommend` (extra path segment); router's GETs do not intercept the inline `POST /api/tickets` (different method).

## Confirmation
- **Mutation routes remain inline**: `POST /api/tickets` (app.js:92), `PATCH /api/tickets/:id` (243),
  `POST /api/tickets/:id/comments` (515), `/api/tickets/:id/recommend` (411), `/api/tickets/:id/assign` (437). ✅
- Frontend (`public/**`) untouched. DB schema & data untouched. A1 "submit not inserting" left documented-only.
- **No `class B` (refactor-introduced) bug** — every smoke check matched baseline.
- **`app.js`: 1472 → 1303 lines.**

---

# Verification Report — Phase 2.4B2 (ticket mutation routes)

**Scope:** move the remaining ticket routes (recommend + 4 mutations) into `src/routes/tickets.routes.js`.
Behavior preserved exactly, **including the known submit bug A1 (not fixed, not worsened)**.

## Approach
First expanded the router's import block with every new dependency and smoke-tested (isolates
"import-resolution" errors from "route-move" errors). Then moved routes ONE at a time, smoke check
after each. `crypto`, the `recentCreates` Map, and (now-only-consumer) `nextTicketNumber` moved into
the router with `POST /api/tickets`.

## Route dependency map (all deps already modular)
| Route | Dependencies |
|-------|--------------|
| `GET /api/tickets/:id/recommend` | requireRole, ADMIN_ROLES, getVisibleTicket, adminScopeForTicket, recommendTechnicians, db |
| `POST /api/tickets/:id/comments` | getVisibleTicket, logActivity, db |
| `POST /api/tickets/:id/assign` | requireRole, ADMIN_ROLES, getVisibleTicket, adminScopeForTicket, isTechnician, deptForRole, logActivity, notify, db |
| `PATCH /api/tickets/:id` | getVisibleTicket, adminScopeForTicket, isTechnician, canClose, validateTransition, URGENCIES, DEPARTMENTS, logActivity, db |
| `POST /api/tickets` | DEPARTMENTS, URGENCIES, isAdmin, crypto, recentCreates, nextTicketNumber, logActivity, notify, db |

## Per-route result (smoke check after EACH move)
| Step | Route moved | Smoke result |
|------|-------------|:------:|
| 0 | (expand router imports only) | ✅ green — all module paths resolve |
| 1 | `GET /api/tickets/:id/recommend` | ✅ green · 403 (role gate) · not shadowed by `:id` (detail `/5` still 404) |
| 2 | `POST /api/tickets/:id/comments` | ✅ green · non-visible ticket → 404 (exact msg); malformed-JSON 500 was a test-payload artifact (body-parser), re-tested clean → 404 |
| 3 | `POST /api/tickets/:id/assign` | ✅ green · 403 (role gate), exact message, no terminal errors |
| 4 | `PATCH /api/tickets/:id` | ✅ green · non-visible ticket → 404, no terminal errors |
| 5 | `POST /api/tickets` | ✅ green · validation identical: `{}`→400 "Department must be IT or ME"; `{dept,outlet}`→400 "Category is required"; no terminal errors |

Full 11-check smoke suite matched baseline after every step.

## Behavior-unchanged verification
- **Author identity** (comments) — still `req.user.username/role/id`; no spoofing path added. Unchanged.
- **Activity log** — every moved route still calls `logActivity` with the same action/detail. Unchanged.
- **Notifications** — `notify("ticket.created"...)` and `notify("ticket.assigned"...)` moved verbatim. Unchanged.
- **Status transitions** — `validateTransition` + tech-subset + `canClose` guards moved verbatim. Unchanged.
- **Permissions/RBAC** — `requireRole(ADMIN_ROLES)` on recommend/assign; dept-admin/assigned-tech gate on PATCH; Leader-blocked comments. Unchanged (verified 403s).
- **Double-submit guard** — `recentCreates` 8s window moved with POST. Unchanged.
- **Ticket-number format** — `nextTicketNumber` unchanged (moved earlier in 2.4A).
- **Route order / no shadowing** — router's `GET /api/tickets/:id` does not intercept `/:id/recommend` (verified: recommend still 403, detail still 404); POST/PATCH are distinct methods.

## Confirmations
- **All ticket routes now live in `src/routes/tickets.routes.js`** (8 routes). No inline ticket route remains in `app.js` (grep-verified).
- **Non-ticket routes untouched & still inline**: `/api/technicians*`, `/api/reports/*`, `/api/users*`, `/api/attachments*`.
- **Frontend (`public/**`) untouched.** **DB schema & data untouched** (POST tested with invalid payloads only — no rows inserted).
- **Existing submit bug A1 NOT fixed and NOT worsened** — POST route moved byte-for-byte; same validation, same duplicate-guard, same INSERT.
- **No `class B` (refactor-introduced) bug** — every smoke check matched baseline.
- Note: a few `require`d symbols in `app.js` (`notify`, `logActivity`, `validateTransition`, `URGENCIES`, `adminScopeForTicket`, `isTechnician`, `canClose`) are now unused there since their only consumers moved. Left in place (harmless, zero runtime effect); will be pruned in a later cleanup to avoid unnecessary churn now.
- **`app.js`: 1303 → 827 lines.**

---

# Verification Report — Phase 2.5A (technician routes)

**Scope:** move all `/api/technicians*` routes into `src/routes/technicians.routes.js`. Behavior preserved
exactly. Users / reports / attachments / frontend untouched.

## Route classification
| Method | URL | Middleware | Class | Moved |
|--------|-----|-----------|-------|:-----:|
| GET | `/api/technicians` | requireAuth + requireRole(ADMIN_ROLES) | read-only (list + open workload) | ✅ |
| GET | `/api/technicians/:id/schedules` | requireAuth + requireRole(ADMIN_ROLES) | schedule read-only | ✅ |
| POST | `/api/technicians/:id/schedules` | requireAuth + requireRole(ADMIN_ROLES) | schedule mutation | ✅ |
| DELETE | `/api/technicians/:id/schedules/:sid` | requireAuth + requireRole(ADMIN_ROLES) | schedule mutation | ✅ |
| POST | `/api/technicians/:id/unavailability` | requireAuth + requireRole(ADMIN_ROLES) | schedule mutation | ✅ |

## Dependencies mapped & wired
`express`, `db` (`../../database`), `requireAuth` + `requireRole` (`../middleware/auth`),
`ADMIN_ROLES` (`../config/constants`), `OPEN_ASSIGNED_STATUSES` (`../../services/recommend`), and the
local helper **`canManageTechnician`** (used only by technician mutation routes — moved into the router
as a module-local function). No `isAdmin`/`isTechnician`/scope helpers were needed.

## Per-route result (smoke check after EACH move)
| Step | Route moved | Smoke result |
|------|-------------|:------:|
| 1 | `GET /api/technicians` | ✅ green · Requestor → 403 (exact msg) · no terminal errors |
| 2 | `GET /api/technicians/:id/schedules` | ✅ green · Requestor → 403 |
| 3 | `POST /api/technicians/:id/schedules` | ✅ green · Requestor → 403 (no write) |
| 4 | `DELETE /api/technicians/:id/schedules/:sid` | ✅ green · Requestor → 403 (no delete) |
| 5 | `POST /api/technicians/:id/unavailability` | ✅ green · Requestor → 403 (no write) + inline `canManageTechnician` removed |

Full 11-check smoke suite matched baseline after every step.

## Behavior-unchanged verification
- **RBAC** — all 5 routes still `requireRole(ADMIN_ROLES)`; Requestor gets 403 "Forbidden. Access denied." on every one (verified). `canManageTechnician` department-scoping moved verbatim.
- **Workload count** — `GET /api/technicians` still counts tickets via `OPEN_ASSIGNED_STATUSES`. Unchanged.
- **Schedules/unavailability** — same SQL, same validation, same 201/400/404 shapes. Unchanged.
- **Assignment/recommendation** — untouched (those live in `tickets.routes.js`); `/api/tickets`+`/api/dashboard` still 200.
- **No shadowing** — `/:id/schedules` vs `/:id/schedules/:sid` distinct; GET vs POST distinct.

## Confirmations
- **All `/api/technicians*` routes now in `src/routes/technicians.routes.js`** (5 routes). No technician route (and no `canManageTechnician`) remains in `app.js` — only a breadcrumb comment.
- **Users / reports / attachments routes untouched & still inline** (10 route refs present in `app.js`).
- **Frontend (`public/**`) untouched. DB schema & data untouched** (mutation routes tested with role-blocked requests only — no rows written/deleted; the 403 fires before any DB call).
- Existing submit bug A1 not touched. Unused `require`s in `app.js` deliberately left as-is (per phase rule).
- **No `class B` (refactor-introduced) bug** — every smoke check matched baseline.
- **`app.js`: 827 → 691 lines.**

---

# Verification Report — Phase 2.5B/C/D + 2.6 (FINAL — backend complete)

Fast-track pass: users → reports → attachments (one group at a time, smoke check after each) then
safe cleanup. **Backend route modularization is now complete.**

## 1. Files changed
- **New:** `src/routes/users.routes.js`, `src/routes/reports.routes.js`, `src/routes/attachments.routes.js`,
  `src/config/uploads.js`, `src/services/upload.service.js`
- **Modified:** `app.js` (routes removed, mounts added, then reduced to a thin bootstrap)

## 2. Routes moved by group
| Group | File | Routes |
|-------|------|--------|
| Users (2.5B) | `users.routes.js` | GET/POST `/api/users`, PATCH/DELETE `/api/users/:id` |
| Reports (2.5C) | `reports.routes.js` | GET `/api/reports/tickets`, GET `/api/reports/export` (+ `queryReport` helper) |
| Attachments (2.5D) | `attachments.routes.js` | POST `/api/attachments/upload`, POST `/api/attachments/upload-chunk`, DELETE/GET `/api/attachments/:id` (+ hourly `cleanupOrphans`) |
| — support | `config/uploads.js` | UPLOADS_DIR, TEMP_DIR, multer `upload`, ALLOWED_MIMES, size limits |
| — support | `services/upload.service.js` | `checkMagicBytes`, `validateFile` |

## 3. Routes remaining inline in app.js
**None.** `grep "app.(get|post|patch|delete)(\"/api"` → 0. app.js contains only middleware + 10 router mounts + static/SPA + error handler + server start.

## 4. Final app.js line count
**63 lines** (from 2166 at the start — a 97% reduction). No API logic remains.

## 5. Smoke result per group
| Group | Smoke result |
|-------|:------:|
| Users | ✅ green · GET/POST/DELETE → 403 for Requestor (baseline); no writes |
| Reports | ✅ green · both routes → 403 for Requestor (not in allowed roles) |
| Attachments | ✅ green · `GET /:id` unknown → 404 "reference not found"; no-auth → 401; upload no-file → 400; `uploads/temp` recreated by config/uploads.js |
| Cleanup (2.6) | ✅ green · full suite below |

### Final full smoke suite (all green, no terminal errors)
- **Auth:** login 200, me 200, logout 200
- **Core:** `/` 200, `/app.js` 200, dashboard 200, tickets 200, `/tickets/99999999` 404, `POST /tickets {}` 400, `/tickets/5/recommend` 403
- **Meta:** brands/outlets/departments/categories all 200
- **Tech/Users/Reports 403; Attachments 404-ref** (Requestor scoping preserved)
- Syntax check: app.js + database.js + public/app.js + all 21 `src/**` files OK

## 6. Frontend untouched
`public/**` was not modified in any phase. Confirmed. API contracts the SPA consumes verified identical (status codes + shapes).

## 7. Database schema/data untouched
No schema change, no migration, no data reset. Mutation routes tested with role-blocked / invalid-payload requests only (403 fires before DB access; POST validation rejects before INSERT). `tickets.db` shows modified solely from login writes during smoke tests.

## 8. Submit bug (A1) not fixed or worsened
`POST /api/tickets` was moved byte-for-byte (Phase 2.4B2) and untouched since. Same validation, same `recentCreates` guard, same INSERT. Still documented-only.

## 9. No class B refactor bug introduced
Every smoke check across every phase matched baseline. No broken import, missing helper, changed status code, changed shape, route shadowing, or permission regression.

## 10. Phase 2.6 cleanup performed (safe only)
- Removed now-unused `require`s from app.js: `fs`, `crypto`, `multer`, `jwt`, `bcrypt`, `recommendTechnicians`, `OPEN_ASSIGNED_STATUSES`, `notify`, `JWT_SECRET`, all constants, all auth/permission/service helpers (each grep-verified unused first).
- Removed dead breadcrumb comments.
- app.js now handles only: env/config, express setup, middleware, route mounting, static serving, error handling, server start.
- No behavior change (verified by the full suite above).

---

## Presentation-ready backend structure

```
app.js  (63 lines — bootstrap only)
database.js  (connection, migrations, seeds — unchanged)
services/            recommend.js, notifications.js  (original, unchanged)
src/
  config/     env.js · constants.js · uploads.js
  middleware/ auth.js            (rateLimit, requireAuth, requireRole, tokens)
  utils/      permissions.js · ticketNumber.js · statusTransition.js
  services/   tickets.service.js · auditLog.service.js · upload.service.js
  routes/     auth · brands · outlets · departments · categories ·
              tickets (+dashboard) · technicians · reports · users · attachments
```
Every router uses full `/api/...` paths and is mounted at `/` in `app.js`, so **no public URL changed**.

## Remaining (not in scope of this backend pass)
- Phase 3–4 frontend split (ordered classic scripts, NOT ES modules — see plan §2)
- Debugging phase for existing bug A1 (submit not inserting)
