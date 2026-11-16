# Security notes

## Authentication
- Email + password. Passwords are hashed with scrypt (N=16384, 16-byte salt) and verified in constant time; the hash scheme is versioned in the stored string.
- Rules: at least 10 characters with a letter and a digit; obvious words rejected; no reuse of the current password.
- Five failed attempts lock the account for 15 minutes (audited). Lock messages do not reveal whether the email exists.
- First sign-in with the starter password forces a password change (when demo data is off).
- Password reset: a 24-byte random token, hashed in the database, valid 60 minutes, single use; completing a reset signs the user out everywhere.
- Microsoft sign-in is not enabled (decision: email + password primary). It can be added as an optional OIDC login later without changing the session model.

## Sessions
- Web: random 32-byte token in an `HttpOnly`, `SameSite=Lax` cookie (`Secure` when `BASE_URL` is https), stored hashed (SHA-256); 14 days, refreshed on use.
- Mobile/API: same tokens as bearer tokens, 90 days, created by `/api/v1/auth/login` or from *My account*.
- "Sign out everywhere" and deactivating an employee delete all their sessions.

## CSRF and browser hardening
- State-changing requests with a cookie session need either the `X-CSRF` header (HMAC of the session token with the server secret), a same-origin JSON request carrying `X-Requested-With: LoyalFlow` (cannot be sent cross-site without a CORS preflight, which is never granted), or a `_csrf` field in HTML forms. The login form uses a double-submit cookie.
- Responses carry `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: same-origin`; Caddy adds HSTS.
- All HTML is rendered through an auto-escaping template; raw HTML is only produced by trusted components. Embedded JSON escapes `<`.
- Static file serving normalises paths and refuses anything outside `public/` or the uploads folder; uploads require a signed-in user.
- Request bodies are capped at 8 MB; dispatch photos at 5 MB.

## Authorisation
- Every route checks an action (`can()`), and individual-level data is filtered by scope (`scopeFor()`): company for executives/HODs, reporting subtree for team leads, self for everyone else.
- Approvals can only be decided by the assigned approver (the CEO/COO may override) and never twice.
- Settings and employee administration are limited to admins (CEO, COO) and HR for people data.

## Data protection
- The database is a single SQLite file in `DATA_DIR`, readable only by the service user inside the container; backups are copies of that file. Encrypt the off-site location (DigitalOcean Spaces with a private bucket, or OneDrive).
- No third-party scripts or trackers are loaded; the only external request from the browser is Google Fonts (optional — fonts fall back to system fonts if blocked).
- GPS positions are stored only for check-ins and field visits, visible to the person and their managers.
- Emails contain ticket subjects and short notes; no passwords are ever emailed (links only).

## Audit
`audit_log` records who did what (entity, action, before/after JSON, request id) for tickets, deals, work orders, tasks, settings, employees, targets, passwords and jobs. Nothing deletes audit rows.

## Keeping it secure
- Keep Node at the current 22 LTS patch (`docker compose up -d --build` after bumping the base image).
- One runtime dependency (`pptxgenjs`); review `npm audit` when upgrading.
- Rotate `SESSION_SECRET` to sign everyone out at once.
- Restrict SSH to key authentication and your IPs; keep automatic security updates on (`unattended-upgrades`).
