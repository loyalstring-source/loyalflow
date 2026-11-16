# JSON API (mobile app and integrations)

Base URL: the server address, e.g. `https://flow.loyalstring.com`. All responses are JSON with `ok: true|false`; errors carry `error` (a sentence you can show) and the HTTP status (400 validation, 401 sign in, 403 not allowed, 404 not found).

## Authentication
```
POST /api/v1/auth/login            {"email": "...", "password": "..."}
→ {"ok": true, "token": "…", "expiresInDays": 90, "user": {id, name, email, designation, department, role, lang, permissions[], scope}}
```
Send the token on every request: `Authorization: Bearer <token>` and `Accept: application/json`. Tokens last 90 days (`API_TOKEN_DAYS`) and are revoked by `POST /api/v1/auth/logout` or "Sign out everywhere" in the web app. Five wrong passwords lock the account for 15 minutes. A user with `mustChangePassword: true` must change it in the web app before using the API.

## Reads
| Endpoint | Returns |
|---|---|
| `GET /api/v1/me` | The signed-in user with permissions |
| `GET /api/v1/today` | Everything on the Today page: date, streak, attendance, alerts, `sops[]` with steps, `tickets[]` with `sla`, `deals[]`, `workOrders[]`, `tasks[]`, `approvals[]`, `myRequests[]`, `notifications[]`, `kpis[]`, `leave` balance |
| `GET /api/v1/tickets?mine=1&status=open|all&q=&limit=` | Tickets with an `sla` object (`state`: ok/warn/breach/met/missed, `minutesLeft`) |
| `GET /api/v1/tickets/:id` | Ticket + `events[]` |
| `GET /api/v1/deals?mine=1&all=1` | Deals (open by default) |
| `GET /api/v1/deals/:id` | Deal + `activities[]` |
| `GET /api/v1/customers?q=` | Customers |
| `GET /api/v1/work-orders?all=1` | Work orders and the stage list (labels in the user's language) |
| `GET /api/v1/work-orders/:id` | One work order |
| `GET /api/v1/sops/today` | Today's checklists for the user with steps |
| `GET /api/v1/approvals` | `forMe[]` (to decide) and `mine[]` (requested) |
| `GET /api/v1/tasks` | Open tasks |
| `GET /api/v1/notifications` | Latest notifications |
| `GET /api/v1/kpi/company` | The 16 company tiles with sparkline values (managers only) |
| `GET /api/v1/kpi/:key?scope=employee|department|company&id=` | One KPI tile + 13-week series, within the user's scope |
| `GET /api/v1/people` | Directory |

## Writes
Writes use the **same paths as the web app**; with a bearer token no CSRF is needed. Send JSON and `Accept: application/json`; the answer is `{ok, toast:{title,body,kind}, confetti?, reload?, redirect?}`.

| Action | Request |
|---|---|
| Check in / out | `POST /attendance/check-in` `{lat, lng}` · `POST /attendance/check-out` |
| SOP step | `POST /sop-runs/:instanceId/steps/:key` `{done: true, evidence: "…"}` (evidence required for note/call/file steps) |
| Approve / decline | `POST /tasks/:id/decide` `{decision: "approved"|"declined", note}` |
| Complete task / timer | `POST /tasks/:id/complete` · `POST /tasks/:id/timer` |
| Leave / expense / purchase | `POST /leave` `{type: CL|SL|PL, from, to, reason}` · `POST /expenses` `{category, amount, description}` · `POST /purchases` `{title, amount, details, neededBy}` |
| New ticket | `POST /tickets` `{customerId|customerName, subject, description, type, priority, channel, assigneeId}` |
| Ticket actions | `POST /tickets/:id/reply` `{text, channel: email|call|note}` · `/assign` `{assigneeId}` · `/priority` `{priority}` · `/status` `{status: in_progress|waiting_customer}` · `/escalate` · `/resolve` `{note}` · `/reopen` `{reason}` |
| Dev issues | `POST /dev` `{title, description, type, priority, projectId, sprintId, assigneeId, points, estimateHours, component, acceptance, customerId, dueDate}` · `POST /dev/:id/status` `{status}` · `/update` `{…fields}` · `/block` `{blocked, reason}` · `/plan` `{sprintId}` · `/release` `{releaseId}` · `/comments` `{text}` · `/checks` `{kind: subtask|test, title}` · `POST /dev/checks/:id` `{done, result: pass|fail}` |
| Projects / sprints / releases | `POST /dev/projects` · `POST /dev/sprints/:id/start` `{goal}` · `/close` · `POST /dev/releases` · `POST /dev/releases/:id/sign` `{role: qa|hod}` · `/ship` |
| Deals | `POST /deals` `{customerId|customerName, city, title, value, source, nextStep, expectedClose}` · `POST /deals/:id/move` `{stage}` · `/lost` `{reason}` · `/update` `{title, value, expected_close, qualified_need, qualified_budget, qualified_timeline, po_received}` · `/quote` `{listTotal, discountPct, currency}` · `/activity` `{kind: call|visit|demo|email|note, notes, outcome, lat, lng, next_step, next_step_due}` |
| Activity without a deal | `POST /activities` `{dealId?, kind, notes, outcome, lat, lng}` |
| Work orders | `POST /work-orders` `{customerId, product, qty, kind, leadTimeDays, promisedDate, assigneeId, notes}` · `POST /work-orders/:id/move` `{stage, invoiceRef, courier, consignment, photo (base64), photoName, qcResult, notes}` · `/assign` `{assigneeId}` |
| Language | `POST /me/lang` `{lang: "en"|"hi"}` |
| Time | `POST /time/start` `{entityType: work_order|task, entityId}` · `POST /time/stop` `{note}` · `POST /time/log` `{entityType, entityId, hours, note, employeeId?}` |
| Procurement | `POST /procurement` `{item, qty, unit, neededBy, supplier, estCost, workOrderId?, dealId?, notes}` · `POST /procurement/:id/status` `{status: ordered|received|cancelled, expectedAt?}` · `POST /work-orders/:id/materials` `{status: ready|short, note}` |
| Budgets | `POST /budgets/:deptId` `{fy, amount, notes}` (admin) |
| Payroll | `POST /payroll` `{month}` · `POST /payroll/:id/build|approve|paid` · `POST /payroll/:id/reopen` `{reason}` · `GET /payroll/:id/bank.csv` · `GET /exports/payroll-:id.xlsx` · `POST /payroll/salaries` `{employeeId, effectiveFrom, ctcAnnual, basic, hra, conveyance, special, …}` · `GET /me/payslips` · `POST /me/tax-declaration` |
| Attendance | `POST /attendance/regularise` `{date, checkIn?, checkOut?, reason}` · `POST /settings/holidays` |
| Appraisals | `POST /appraisals/cycles` `{name, periodFrom, periodTo, selfDue?, managerDue?}` · `POST /appraisals/cycles/:id/open` · `POST /appraisals/:id/self|manager` `{review, rating}` · `POST /appraisals/:id/moderate` `{finalRating, incrementPct, decision}` · `POST /appraisals/:id/probation` `{outcome, review, rating, extendTo?}` · `POST /appraisals/:id/apply` `{effectiveFrom}` · `POST /appraisals/probation-scan` |
| Hiring | `POST /hire/req` `{title, departmentId, positions, budgetCtc?, justification, …}` · `POST /hire/req/:id/submit|close` · `POST /hire/candidates` `{fullName, email?, phone?, requisitionId?, source?, confirmDuplicate?}` (409 on a likely duplicate) · `POST /hire/app/:id/stage` `{to}` · `POST /hire/app/:id/close` `{outcome, reason}` · `POST /hire/app/:id/schedule` `{roundType, startsAt, minutes, panel[], force?}` (409 on a panel clash) · `POST /hire/interview/:id/scorecard` `{r_<area>…, recommendation, evidence, notes, submit}` · `POST /hire/app/:id/offer` · `POST /hire/offer/:id/submit|issue` · `POST /hire/offer/:id/response` `{response, note}` · `POST /hire/offer/:id/onboard` `{employeeId, email, reportingManagerId}` |
| Imports | `POST /imports/:entity` `{file: <base64 xlsx/csv>, fileName}` → `redirect` to the preview · `POST /imports/preview/:id/commit` |

Visits should include `lat`/`lng` (field GPS is mandatory by policy); the server computes the distance from the previous visit that day.

## Building the mobile app
- Today: the web app is installable ("Add to Home Screen") and already adapts to phones; geolocation and camera work from the browser over HTTPS.
- Native wrapper when push notifications are wanted: a Capacitor shell that opens the web app (cookie session) or a small native UI on this API. Push can be added with a device-token table and a `notify` hook; the notification payloads already contain `title`, `body`, `link` and `kind`.
