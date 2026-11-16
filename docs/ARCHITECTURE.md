# Architecture

## Goals that shaped it
- **One deployable unit** that runs on a laptop, a US$24 server and a phone, with no build pipeline and no external services except email.
- **Boring, long-lived technology**: Node 22 LTS, SQLite, server-rendered HTML. A single person can understand and maintain all of it.
- **Rules live in one place**: SLA calendars, approval routing, exit rules, escalation ladders and KPI definitions are code in `src/modules/*`, used identically by the web pages, the JSON API and the scheduler.

## Stack
| Layer | Choice | Notes |
|---|---|---|
| Runtime | Node.js ≥ 22.18, ESM, TypeScript sources executed directly | Node strips types; `tsc` is only used for type-checking (and an optional `dist/`). |
| Database | SQLite via `node:sqlite`, WAL mode, foreign keys on | One file in `DATA_DIR`. Migrations in `src/db/migrations.ts` run at start. Backups with `VACUUM INTO`. |
| HTTP | `node:http` + a 130-line router (`src/lib/http.ts`) | Cookie sessions, bearer tokens, JSON or form bodies, 8 MB limit. |
| Views | `html` tagged template with auto-escaping (`src/lib/html.ts`) | Pages are plain functions returning HTML. No client framework. |
| Client | `public/app.js` (vanilla, ~15 KB) | JSON posts with CSRF, drawers/modals loaded as HTML fragments, toasts, confetti, rings, GPS, file → base64, keyboard shortcuts, PWA registration. |
| Styling | `public/app.css` design tokens | IBM Plex Sans, 14 px base, four semantic colours, responsive to 360 px with a bottom tab bar. |
| Exports | Own XLSX writer (`src/lib/xlsx.ts`), `pptxgenjs` for PowerPoint | The only runtime dependency. |
| Jobs | In-process scheduler (`src/jobs.ts`) ticking every minute | SLA checks, KPI snapshots (15 min), SOP generation and escalation, nightly backup, Monday digest. |
| Tests | `node:test` for unit/integration, Playwright for end-to-end | See `docs/TESTING.md`. |

## Folder map
```
src/
  server.ts            HTTP server, middleware (static, session, CSRF, forced password change), error pages, startup seed, scheduler
  app.ts               App context: config, db, mailer, notifier
  config.ts            Environment → Config (see .env.example)
  cli.ts               seed | backup | set-password | snapshot
  jobs.ts              Background jobs + scheduler
  db/                  Db wrapper, migrations, master seed (44 employees, departments, SOPs), demo seed
  lib/                 html, http, crypto, auth, settings, scope (permissions), time (IST, shifts, business minutes), audit, mailer, notify, xlsx
  modules/
    people/            Employee model, reporting lines
    desk/              Tickets, SLA, dev issues
    sales/             Customers, deals, quotes, activities
    production/        Work orders and stages
    sops/              SOP definitions, daily instances, escalation, compliance
    tasks/             Tasks, approvals, leave, expenses, routing
    kpi/               KPI definitions and engine (compute, targets, RAG, snapshots, series), per-department views
  routes/              One file per area: builds data, calls modules, renders pages (HTML or JSON)
  ui/                  layout (shell, nav), components (tiles, pills, rings, charts, forms), pages/* (one per area)
public/                app.css, app.js, icons, manifest, service worker
tests/                 unit/, integration/ (service flows + real HTTP), helpers
e2e/                   Playwright specs (desktop and phone)
docs/                  this folder
```

## Request flow
1. `server.ts` builds a `Ctx` (method, path, query, cookies, lazy body, `wantsJson`, `partial`).
2. Static assets short-circuit. The session is resolved from the `lf_session` cookie or `Authorization: Bearer`.
3. Public router (login, reset, rating, health, API login). Everything else requires a user → otherwise redirect to `/login?next=` (or 401 JSON).
4. CSRF for cookie sessions on non-GET: `X-CSRF` header, or JSON body with `X-Requested-With: LoyalFlow` from the same origin, or a `_csrf` form field. Bearer sessions skip CSRF (they are not replayable by a browser).
5. Users flagged `must_change_password` are sent to `/change-password`.
6. A `View` (user, csrf, language, badge counts, department, manager flag) is attached and the authenticated router dispatches. Route handlers return `Response` objects; `done()` answers JSON `{ok, toast, reload, redirect, confetti…}` for fetch callers and a redirect for plain forms, so every action works with and without JavaScript.
7. Errors: `HttpError(status)` → friendly page or JSON; anything else → 500 logged with a request id.

## Permissions (`src/lib/scope.ts`)
- **Actions** such as `desk.write`, `sales.manage`, `reports.company`, `settings.admin` are decided from department code + functional role (`executive`, `hod`, `team_lead`, `ic`) + `is_admin`.
- **Scope** decides whose individual numbers you can open: executives and HODs — the whole company (transparent model, decision B5); team leads — their reporting subtree; everyone else — themselves. Routes use `scopeFor(db, user).people` to filter.

## KPI engine (`src/modules/kpi/engine.ts`)
- 32 definitions with band, owner department, unit, direction, default target, amber factor, period kind (`now`, `week`, `month`) and a `compute()` over the database, or `manual` for finance/production numbers typed in weekly.
- Live values use a rolling 7-day window; month-to-date targets are prorated by the day of the month, so early days are not red by default.
- Every 15 minutes `snapshotNow()` stores the current ISO week's value for company, each department and (for per-person KPIs) each employee; `series()` returns 13 weeks for sparklines and charts; `redStreak()` counts consecutive red weeks.
- Targets: `kpi_targets` per scope with reason and author; HOD proposals become COO approval tasks that apply the target when approved.

## Time (`src/lib/time.ts`)
Everything is stored as UTC ISO strings; display and business-hour arithmetic use IST (+05:30) without a timezone library. Shifts (`GEN`, `DEV`, `SUP`, `SAL`, `PRD`) and holidays come from Settings. `addBusinessMinutes()` powers SLA due times and SOP step deadlines; P1 uses the always-on calendar.

## Data model (main tables)
`employees`, `departments`, `sites`, `sessions`, `password_resets`, `customers`, `tickets`, `ticket_events`, `dev_issues`, `deals`, `quotes`, `activities`, `work_orders`, `tasks` (tasks and approvals), `leave_requests`, `expenses`, `sop_definitions`, `sop_instances`, `kpi_snapshots`, `kpi_targets`, `attendance`, `notifications`, `audit_log`, `settings`, `counters` (human ids: T-4201, DL-2250, WO-1032, A-105, S-1001, Q-1181, C-101, D-301).

## Why not React / Postgres / a cloud BI tool
- The team is 44 people on one site; SQLite handles this volume for years, has zero operations overhead and backs up as a single file. Moving to Postgres later is a `Db` wrapper change plus migrations; the SQL is kept standard.
- Server-rendered pages with small enhancements load fast on factory-floor phones, need no build step and keep the whole UI in readable TypeScript. The JSON API exists for a native wrapper (Capacitor) when push notifications are wanted.
- Charts and exports are built in; Microsoft 365 Business Basic has no Power BI, and the weekly review needs one page, not a BI project.
