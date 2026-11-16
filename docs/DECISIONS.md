# Business rules encoded in LoyalFlow

These come from the discovery and the questionnaire answered by the COO on 2 Nov 2026 (decision log v3 in the LoyalFlow project). Each line says where the rule lives, so it can be checked or changed.

| Rule | Decision | Where |
|---|---|---|
| Organisation | CEO Rahul Thakare; COO Sridhar Narayanagowda; Sales Head Muruganandam K and Prateek Sharma report to the CEO; everyone else rolls up to the COO. Mahesh Mapari is Production HOD and Accounts. Team leads: Prasad Panchal (Support), Shubham Bherde (.NET), Lukman Nishad (Dispatch). QA under Karan Bhoite. Pre-sales (Madhuri Vichare, Rudrat Kumar Dey) is its own team under the COO. Employee ids LS001–LS044. | `src/db/seed-master.ts`; editable in People |
| Reporting model | Transparent: executives and HODs see all individual numbers; team leads their subtree; staff their own KPIs only, no ranking. | `src/lib/scope.ts` |
| Calendar | FY April–March, weeks Monday–Saturday (ISO week labels), IST, month-to-date with prorated targets. | `src/lib/time.ts`, `src/modules/kpi/engine.ts` |
| Shifts | Support Mon–Sat 10–19; Dev/QA Mon–Fri 9–18; Sales/Pre-sales Mon–Sat 9–18; Production Mon–Sat 10–19 with overtime; others Mon–Sat 9–18. Changeable (UK hours) in Settings. | Settings → Shifts |
| Holidays | Maharashtra list for the year, editable. | Settings → Shifts & holidays |
| SLA | P1 15 min / 4 h always-on; P2 1 h / 1 business day; P3 4 h / 3 days; P4 next day / 7 days; no customer tiers. Warn assignee + lead at 50 %; COO on breach. Reopen restarts the clock. Resolved tickets auto-close after 3 days. | Settings → SLA; `src/modules/desk/service.ts` |
| Implementations | Tracked as tickets of type implementation with a day plan (default 21) and average days open on the company page. | `createTicket()` |
| Escalation to development | Agent escalates; a dev issue is created with the ticket's priority; ticket waits; release returns it to support; the Dev HOD is told. | `escalateToDev()`, `setDevStatus()` |
| Customer rating | One-click rating link in the resolution email (1–5). | `/rate/:token` |
| Sprints | One-week sprints; board backlog → planned → in progress → in review → in QA → ready → released. | `/dev` |
| Pipeline stages | New 10 % → Contacted 20 % → Qualified 40 % → Demo 55 % → Proposal 70 % → Negotiation 85 % → Won; Lost with reasons (Price, Timeline, Feature gap, No budget, Chose competitor, No response). | `src/modules/sales/service.ts` |
| Exit rules | Qualified needs need, budget and timeline; Proposal needs a quote; Won needs an approved discount and a PO/advance. | `exitRuleProblem()` |
| Discounts | ≤5 % BDM alone; ≤10 % Sales Head; above COO. Requested automatically with the quote. | Settings → Approvals; `createQuote()` |
| Won deal | In one transaction: work order (queued, promised date from lead time), invoice request task to the Accounts owner (due +2 days), implementation ticket to the Support lead (21-day plan); Sales Head and COO notified. | `winDeal()` |
| Field visits | GPS mandatory for visits; distance from the previous visit that day is computed and shown. | `addActivity()`, `app.js` geolocation |
| Multi-currency | Deals and quotes carry a currency (INR default; USD, AED, EUR offered); company figures shown in ₹. | Deals |
| Production | Stages queued → in production → (QC optional) → packed → dispatched → delivered; default lead time 7 days; dispatch requires invoice reference, courier and consignment number, photo optional; customer emailed; Hindi labels for the floor. | Settings → ops; `moveWorkOrder()` |
| Design requests | A work-order kind routed to the mechanical engineer (Amar Aher). | `createWorkOrder()` |
| Approvals | Expenses and purchases: ≤₹10,000 team lead, ≤₹50,000 HOD, above COO. Leave: ≤3 days manager, longer HOD. Discounts as above. Only the assigned approver (or CEO/COO) decides; decisions are notified. | Settings → Approvals; `routeApproval()` |
| Targets | HOD proposes, COO approves (approval task applies the target); COO/CEO set directly; every change needs a reason and is audited; daily/weekly/monthly targets via the period kind of each KPI. | `/kpi/:key` |
| Weekly review | Mandatory Monday CEO+COO review; company page with 16 tiles in four bands; PowerPoint pack for CEO/COO; Excel for managers; Monday 08:00 digest to CEO, COO and HODs. | `/company`, `/exports/*`, `jobDigest()` |
| SOPs | Five starter SOPs (support huddle, Monday pipeline review, dispatch checklist, month-end close, new-hire onboarding); HOD authors; evidence per step (note, call summary, file, system record); one business day grace then manager → HOD → COO. | `src/db/seed-master.ts`, `src/modules/sops/service.ts` |
| Attendance and leave | Check-in/out with GPS from Today; leave types CL 12 / SL 6 / PL 15 per year; monthly attendance and leave Excel for payroll (PagarGuru replacement, phase 1). | `/attendance/*`, `/exports/attendance.xlsx` |
| Executive tasks | CEO/COO assign tasks with due dates; assignees run timers; minutes logged. | `/tasks` |
| Login | Work email + password managed in LoyalFlow; welcome/password links by email; lockout after 5 failures; 10+ character passwords, no reuse; Microsoft sign-in optional later. | `src/lib/auth.ts` |
| Hosting | DigitalOcean Bangalore, Docker, Caddy HTTPS; laptop for the COO's own checks. | `docs/DEPLOY.md` |
| Retention and audit | Nothing is deleted; audit log for every change; exports limited to managers and audited. | `src/lib/audit.ts` |
| Payroll | Salary structures are effective-dated and never edited in place. A run goes draft → approved → paid; a draft rebuilds freely, an approved run can be reopened, a **paid run is locked** and corrections go in the next month. Payslips become visible to employees on approval. | `src/modules/hr/payroll.ts` |
| Statutory rates | Every PF, ESI, PT and income-tax rate and slab lives in Settings → Statutory, not in the code. Payslips carry a warning until `verifiedByCa` is ticked. LoyalFlow computes; the company's CA owns the rates. | Settings → statutory |
| Missing attendance | During roll-out, a working day with no record counts as present (`treatMissingAsPresent`), so a missed punch never silently costs someone a day's pay. Switched off once check-in is reliable. | Settings → payroll |
| Attendance corrections | Within 45 days, on a working day, one pending request per day; routed to the reporting manager; the attendance row is written only on approval. | `src/modules/hr/attendance.ts` |
| Appraisals | Self review → manager → HOD moderation → COO approval. KPIs are captured when the cycle opens and shown as evidence; the rating is a human judgement, never computed. An approved increment is applied by HR as a new effective-dated salary — nothing changes pay automatically. | `src/modules/hr/appraisal.ts` |
| Probation | Six months from the join date; the review is created three weeks before and decided by the reporting manager (confirm / extend / exit). | `generateProbationReviews()` |
| Candidate privacy | Candidate records and CVs are visible to HR, the hiring manager, the recruiter, the application owner and anyone on a panel for that application. Nobody else, including other managers. | `canSeeApplication()` |
| Scorecards | One per interviewer, with evidence required to submit. Others' scorecards are hidden until the whole panel has submitted; HR can open them early for calibration. | `visibleScorecards()` |
| Hiring decisions | No score rejects anybody: closing an application needs a named person and a written reason. An offer is drafted, approved by the COO, then **issued by hand** — approval alone sends nothing. | `closeApplication()`, `issueOffer()` |
| Headcount | A requisition needs COO approval before any candidate can be attached to it. | `submitRequisition()` |

## Not in this release (planned)
Tally Prime connector, WhatsApp Business API, Smartflo telephony, IndiaMART and website lead capture, offline capture on the floor tablet beyond the PWA cache, Microsoft sign-in, native store apps (Capacitor wrapper over the JSON API). Added in 1.1: imports, procurement forecast and material check, man-hours, travel report, departmental budgets. Added in 1.3: payroll and statutory computation (run one month in parallel with PagarGuru before switching), attendance completion, appraisals and probation, LoyalHire recruiting.
