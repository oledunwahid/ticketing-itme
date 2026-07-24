# OmniDesk / Ticketing IT-ME — Refactor Plan & Risk Assessment

> **Prime directive:** DO NOT INTRODUCE NEW ERRORS. Stability > perfect structure.
> Refactor is **incremental**. After every move: syntax-check → boot test → smoke test.
> Existing bugs (e.g. "submit not inserting") are **documented, not fixed** here (see `BUG-LOG.md`).

---

## 0. Baseline (known-good, captured before any change)

| Check | Result |
|-------|--------|
| `node --check app.js` / `database.js` / `services/*` / `public/app.js` | all OK |
| Boot (`PORT=3999 node app.js`) | "Database ready…", "server running…" |
| `GET /` | 200 |
| `GET /app.js` | 200 |
| `GET /api/auth/me` (no cookie) | 401 `{"error":"Unauthorized. Please log in."}` |

If any step below regresses one of these, **roll back that step** and stop.

---

## 1. Current-state map

### Backend files
| File | Lines | Role |
|------|------:|------|
| `app.js` | 2166 | Monolith: config, constants, middleware, ALL routes, helpers, server bootstrap |
| `database.js` | 628 | SQLite connection, promisified helpers (`pRun/pAll/pGet/pExec`), migrations, seeds, `db.ready` |
| `services/notifications.js` | 67 | `notify()` |
| `services/recommend.js` | 121 | `recommendTechnicians`, `OPEN_ASSIGNED_STATUSES` |

### Frontend files
| File | Lines | Role |
|------|------:|------|
| `public/app.js` | 1566 | Single **classic** script (not a module). All views/api/helpers in one scope |
| `public/index.html` | 75 | Loads `<script src="app.js">`. **No inline onclick handlers** |
| `public/style.css` | 441 | Styles |

### Endpoints (all must keep identical URL + response shape)
```
POST   /api/auth/register          GET    /api/technicians
POST   /api/auth/login             GET    /api/technicians/:id/schedules
POST   /api/auth/logout            POST   /api/technicians/:id/schedules
GET    /api/auth/me                DELETE /api/technicians/:id/schedules/:sid
GET    /api/meta/brands            POST   /api/technicians/:id/unavailability
GET    /api/meta/outlets           GET    /api/dashboard
GET    /api/outlets                GET    /api/reports/tickets
POST   /api/outlets                GET    /api/reports/export
PATCH  /api/outlets/:id            GET    /api/users
DELETE /api/outlets/:id            POST   /api/users
GET    /api/meta/departments       PATCH  /api/users/:id
GET    /api/meta/categories        DELETE /api/users/:id
GET    /api/categories             POST   /api/attachments/upload
POST   /api/categories             POST   /api/attachments/upload-chunk
PATCH  /api/categories/:id         DELETE /api/attachments/:id
DELETE /api/categories/:id         GET    /api/attachments/:id
POST   /api/tickets                GET    *  (SPA fallback)
GET    /api/tickets
GET    /api/tickets/:id
PATCH  /api/tickets/:id
GET    /api/tickets/:id/recommend
POST   /api/tickets/:id/assign
POST   /api/tickets/:id/comments
```

### Shared backend building blocks (the coupling)
- **Config:** `PORT`, `JWT_SECRET`, `NODE_ENV`
- **Constants:** `STATUSES`, `URGENCIES`, `DEPARTMENTS`, `ADMIN_ROLES`, `UPLOADS_DIR`, `TEMP_DIR`
- **Multer:** `upload` (dest = `uploads/temp`)
- **Module-level mutable state:** `rateBuckets` (used only by `rateLimit`), `recentCreates` (used only by `POST /api/tickets`)
- **Middleware:** `rateLimit`, `requireAuth`, `requireRole`
- **Auth helpers:** `signToken`, `setSessionCookie`
- **RBAC/scope helpers:** `deptForRole`, `isAdmin`, `isTechnician`, `adminScopeForTicket`, `canClose`, `getUserScope`, `buildTicketScope`, `canManageTechnician`
- **Domain helpers:** `logActivity`, `nextTicketNumber`, `getVisibleTicket`, `validateTransition`, `queryReport`
- **Upload helpers:** `checkMagicBytes`, `validateFile`, `cleanupOrphans`
- **External:** `db`, `recommendTechnicians`, `notify`

---

## 2. Risk assessment (what will bite us)

| Area | Risk | Why | Mitigation |
|------|:----:|-----|-----------|
| **`__dirname`-based paths** (`UPLOADS_DIR`, `public/`, `tickets.db`) | HIGH | Moving code into `src/**` changes `__dirname`; paths would silently point to the wrong folder | Anchor all paths to a single `PROJECT_ROOT` constant; keep DB path in `database.js` untouched |
| **Ticket routes ↔ helpers** (`buildTicketScope`, `getVisibleTicket`, `validateTransition`, `logActivity`) | HIGH | Tightly coupled; a ticket route uses 4–6 shared helpers | Extract helpers into a shared module *first*, keep them exported, move routes only after helpers are importable |
| **`requireAuth` sliding-cookie side effect** | MED | It re-sets the cookie every request; must keep `JWT_SECRET` + `setSessionCookie` together | Keep auth middleware + token helpers in one `middleware/auth` module |
| **Module-level state** (`rateBuckets`, `recentCreates`) | MED | If a route is moved but its Map stays in `app.js`, the reference breaks | Move each Map into the same module as its only consumer |
| **Frontend one-scope script** | MED | `const`/`function` are shared across the single classic script; splitting to ES modules requires import/export everywhere | Split into **ordered classic scripts** (shared global lexical scope preserved) — NOT ES modules — to keep zero behavior change |
| **`db.ready` boot ordering** | MED | Server must `listen` only after migrations finish | Keep `db.ready.then(listen)` in `app.js` bootstrap, unchanged |
| **Response shapes** | HIGH (business) | Any route returning a different JSON shape breaks the SPA | Never edit handler bodies during a *move*; copy verbatim |
| **`git`-tracked `tickets.db`** | LOW | DB is `.gitignore`d but already committed (shows as modified) | Recommend `git rm --cached tickets.db` (does NOT delete the file) — flagged, not auto-run |

### Tightly-coupled clusters (move as a unit, never split mid-cluster)
1. **Auth cluster:** `JWT_SECRET`, `signToken`, `setSessionCookie`, `requireAuth`, `requireRole`, `rateLimit` + `rateBuckets`
2. **RBAC/scope cluster:** `deptForRole`, `isAdmin`, `isTechnician`, `adminScopeForTicket`, `canClose`, `getUserScope`, `buildTicketScope`
3. **Ticket cluster:** `nextTicketNumber`, `getVisibleTicket`, `validateTransition`, `logActivity`, `recentCreates` + the 6 `/api/tickets*` routes
4. **Upload cluster:** `upload`, `UPLOADS_DIR`, `TEMP_DIR`, `checkMagicBytes`, `validateFile`, `cleanupOrphans` + the `/api/attachments*` routes

---

## 3. Phased plan (small steps, smoke check each)

> Legend: ✅ = done & verified · ⏳ = planned

### Phase 1 — Backend safety cleanup (LOWEST risk)
| Step | Files | Smoke check | Status |
|------|-------|-------------|:------:|
| 1.1 Confirm `.gitignore` (already present & correct) | `.gitignore` | n/a | ✅ |
| 1.2 Extract env → `src/config/env.js` | new + `app.js` | boot + 3 endpoints | ✅ |
| 1.3 Extract constants → `src/config/constants.js` | new + `app.js` | boot + 3 endpoints | ✅ |

### Phase 2 — Backend shared modules & route groups (one cluster at a time)
| Step | Files | Smoke check | Status |
|------|-------|-------------|:------:|
| 2.1 Extract auth cluster → `src/middleware/auth.js` | new + `app.js` | login + `/api/auth/me` | ✅ |
| 2.2 Extract RBAC/scope → `src/utils/permissions.js` | new + `app.js` | ticket list scoping | ✅ |
| 2.x Extract auth routes → `src/routes/auth.routes.js` | new + `app.js` | login/me/logout | ✅ |
| 2.3 Move meta/reference routes (brands, outlets, departments, categories) | `src/routes/{brands,outlets,departments,categories}.routes.js` + `app.js` | each GET/POST/PATCH/DELETE | ✅ |
| 2.4A Extract ticket helpers (`logActivity`, `nextTicketNumber`, `getVisibleTicket`, `validateTransition`) | `src/services/{auditLog,tickets}.service.js`, `src/utils/{ticketNumber,statusTransition}.js` + `app.js` | tickets/detail/dashboard | ✅ |
| 2.4B1 Move read-only ticket routes (`GET /api/tickets`, `/:id`, `/api/dashboard`) | `src/routes/tickets.routes.js` + `app.js` | list/detail/dashboard shapes | ✅ |
| 2.4B2 Move ticket **mutation** routes (recommend, comments, assign, PATCH, POST) | `src/routes/tickets.routes.js` + `app.js` | validation/RBAC/404 shapes per route | ✅ |
| 2.5A Move technician routes (list, schedules GET/POST/DELETE, unavailability) | `src/routes/technicians.routes.js` + `app.js` | RBAC 403s per route | ✅ |
| 2.5B Move users routes | `src/routes/users.routes.js` + `app.js` | users RBAC/validation | ✅ |
| 2.5C Move reports routes | `src/routes/reports.routes.js` + `app.js` | reports RBAC + CSV | ✅ |
| 2.5D Move attachments routes | `src/routes/attachments.routes.js`, `src/config/uploads.js`, `src/services/upload.service.js` + `app.js` | upload/validate/access | ✅ |
| 2.6 Safe cleanup (prune unused requires, thin bootstrap) | `app.js` | full suite | ✅ |

> **Phase 2.5A note:** all 5 `/api/technicians*` routes + the `canManageTechnician` helper moved into
> `src/routes/technicians.routes.js`.
>
> **Phase 2.5B/C/D + 2.6 (FINAL):** users/reports/attachments extracted; app.js reduced to a **63-line
> bootstrap** (from 2166). **Backend route modularization complete** — 0 inline API routes remain.
> Attachments support split into `src/config/uploads.js` (dirs+multer+MIME) and
> `src/services/upload.service.js` (magic-byte validation). See VERIFICATION-REPORT.md for the final
> structure and full smoke results.

### ✅ Backend phase status: COMPLETE
All backend routes are modularized. Remaining work (Phases 3–4 frontend, and bug A1 debugging) is
out of scope for the backend pass and awaits separate approval.

> **Phase 2.4B2 note:** all 8 ticket routes now in `src/routes/tickets.routes.js`; `app.js` has no inline
> ticket route left (2166 → 827 lines overall). POST `/api/tickets` moved byte-for-byte — known submit
> bug A1 preserved, not fixed. A few now-unused `require`s remain in `app.js` (harmless; prune later).

> **Phase 2.3 note:** router files only — no controller/repository layers (kept small; no over-engineering).
> All four groups' routes depend only on already-modular helpers (`requireAuth`, `requireRole`, `db`, `DEPARTMENTS`).
>
> **Phase 2.4A note:** helpers only — ticket routes stay inline. `validateTransition` is pure (no db);
> `getVisibleTicket` reuses `buildTicketScope`. All deps already modular, so no code left behind.

### Phase 3 — Frontend low-risk cleanup (ordered classic scripts)
| Step | Files | Smoke check |
|------|-------|-------------|
| 3.1 Split utils (`esc`, `fmtDate`, `badge`, …) → `public/js/utils/*.js` | new + `index.html` | dashboard renders |
| 3.2 Split API layer (`api`, `rawFetch`, `apiJSON`) → `public/js/api/*.js` | new + `index.html` | login + lists load |
| 3.3 Split views one at a time | `public/js/views/*.js` | each view |

### Phase 4 — Frontend view/form modularization
Move one feature (view + its form) at a time; verify buttons/modals after each.

### Phase 5 — Bug documentation
See `BUG-LOG.md` (already drafted). No fixes during refactor.

---

## 4. Rollback protocol
Each step is a single logical change. If a smoke check fails:
1. `git diff` the step, `git checkout -- <file>` (or revert the new require).
2. Re-run the baseline smoke check to confirm green again.
3. Re-plan the step smaller.

Nothing in this refactor touches `tickets.db` data, table schemas, endpoint URLs, or response shapes.
