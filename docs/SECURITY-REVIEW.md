# Security & quality review — 2026-09-17

Scope: whole application (backend routes, auth, uploads, DB layer, SPA, repo hygiene) for an
on-prem deployment (LAN / Synology, often plain HTTP). Verified with `npm run check`
(ESLint + `test/api.test.js`, 17 end-to-end scenarios on a throw-away DB).

## Fixed — critical / high

| # | Issue | Fix |
|---|-------|-----|
| 1 | **Path traversal in chunked upload** — client `fileId` was used in a filesystem path, so any signed-in user could append to / overwrite files such as `public/app.js`. | `fileId` is a validated token namespaced per user; chunks must arrive in order; stored files always get a server UUID; size measured on disk. |
| 2 | **Fonnte API tokens hard-coded** (`services/fonnte.js`, `services/notifications.js`, `examples/test-live-send.js`) and WhatsApp sending on by default. | Tokens come only from `.env`; sending needs a token. **Rotate both tokens** — they are in git history. |
| 3 | **Database, backups, uploads and `users_with_hashes.csv` committed** to git. | Untracked + `.gitignore`d. They remain in history — purge (e.g. `git filter-repo`) if the repo was ever shared, and treat those password hashes as exposed. |
| 4 | Attachment ownership: comments / new tickets could re-link **any** attachment id; any non-requestor could delete any attachment. | Only the uploader's own unlinked uploads can be attached; linked evidence can only be deleted by the ticket's department admin. |
| 5 | Sessions stayed valid after deactivation, role change or password reset (role was read from the JWT for up to 14 days). | The user row is reloaded on every request; `token_version` revokes sessions on password change / reset / deactivation / role change. |
| 6 | Session cookie was `Secure` whenever `NODE_ENV=production` → login impossible over plain-HTTP on-prem. | Follows `APP_URL` scheme (override: `COOKIE_SECURE`). |
| 7 | Duplicate ticket numbers under concurrent creates (read-after-upsert race → 500). | Single `INSERT … RETURNING` + retry on collision. |
| 8 | Fresh install created **no admin** (migration inserted a user before the seed ran). | Seed fixed; optional `ADMIN_EMAIL` / `ADMIN_PASSWORD` bootstrap. |
| 9 | CORS `*`, no security headers. | Same-origin by default (`CORS_ORIGINS` allowlist), CSP, X-Frame-Options, nosniff, Referrer-Policy, cross-site POST blocked. |

## Fixed — medium / edge cases

- Tracking-token hash no longer returned by ticket APIs; tokens masked in access logs.
- Rate limiter: failures only for login (NAT-friendly), pruned buckets, `TRUST_PROXY` support; bcrypt made async; constant-time-ish unknown-user path.
- AdminIT/AdminME could not save their own profile (bogus "SuperAdmin role" error); self-deactivation and last-SuperAdmin demotion/deletion now blocked; duplicate username/email returns 400 instead of 500.
- AdminME had no Users page although the API allowed it.
- Technicians with all-outlet access got "not found" opening tickets outside their PIC list.
- Reopening kept stale `resolved_at` / `closed_at` (wrong SLA); reopen / cancel reasons now logged.
- Department re-route could leave a category from the other department.
- Self-assign race could produce two Primary technicians.
- Input validation & length limits on tickets, users, schedules (overlaps), public reports (phone), dates; malformed JSON → 400, oversized body → 413, multer limits.
- Category / outlet renames now carry over to existing tickets and PIC coverage; department scoping for category management.
- Report date filters and "created today" used UTC dates instead of local days; unavailability blocks were compared in the wrong time zone.
- CSV exports neutralise spreadsheet formulas (phone numbers still round-trip).
- Never-linked uploads cleaned up after 24h (public upload disk-fill).
- `.env` no longer overrides real environment variables; `DB_PATH` from `.env` is honoured.
- Performance: dashboard is one query; technician workload, recommendations, user list and schedules no longer N+1; WAL mode + indexes.
- `npm audit fix` applied (express, multer, morgan, body-parser, qs).

## Known / follow-up

- `npm audit` still lists `sqlite3@5` → `node-gyp` → `tar` advisories. They affect **install-time** builds only; the fix is a sqlite3 major upgrade (test on the Synology image first).
- Several seeded accounts use the documented demo password `Password123!` — the server logs a warning in production. Change or deactivate them.
- AdminIT/AdminME can reset passwords of peer admins in their department (by design; revisit if unwanted).
- `scratch/verify_*.js` write to the live `tickets.db`; use `npm test` instead.
- No HTTPS: if the app is ever exposed beyond the LAN, put it behind a TLS proxy and set `APP_URL=https://…`.

## Analytics dashboard (added later the same day)

- `GET /api/analytics` and `/api/analytics/export` reuse `buildTicketScope`: every chart, KPI and export only covers tickets the caller can already see. Filter values are validated/whitelisted; dates must be YYYY-MM-DD and ranges are capped at three years.
- XLSX files are generated without a third-party library (`src/utils/xlsx.js`); cell text is written as inline strings, so text such as `=HYPERLINK(...)` is never evaluated as a formula. CSV exports use the same formula guard as the other exports.
- Chart labels are inserted with `textContent` only.
