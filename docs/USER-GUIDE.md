# User guide, by role

Sign in at the LoyalFlow address with your work email. On a phone, open the same address and choose *Add to Home Screen*; it then works like an app.

Everyone has **Today**: check in, tick today's SOP steps, see approvals waiting for you, your open work, your numbers for the week, updates, and your leave balance. The ring fills as you complete steps; finish everything on time for a few days and a streak appears.

## CEO and COO
- **Company page** (Monday review): four bands, 16 tiles, red/amber/green against targets, sparkline of the last 13 weeks. Anything red for two or more weeks is called out at the top. *PowerPoint* produces the review deck; *Excel* the numbers with history and the approvals list. Click a tile for definition, trend, per-person breakdown and target history.
- **Targets**: open a KPI → *Set the target* with a reason. HODs can only propose; proposals arrive as approvals.
- **Approvals**: discounts above 10 %, expenses and purchases above ₹50,000, target proposals, anything escalated. Approve/decline from Today or the Approvals page; declining asks for a reason the requester sees.
- **Needs you** on Today lists red KPIs, SLA breaches, deals stuck over 14 days, late work orders and overdue SOP checklists across the company.
- **Settings** (COO as admin): roles, SLA matrix, shifts and holidays, approval thresholds, SOP grace, QC, leave quotas; system jobs and backups.

## Managers (HODs and team leads)
- **Analytics**: your department's KPIs, the trend of any KPI, and every person's numbers side by side (the transparent model — staff see only their own).
- **My team** filters on the Service desk and Pipeline boards; **By person** tab on SOPs.
- **Assign tasks** (Tasks → *Assign a task*): the person is notified, the task shows on their Today, and they can run a timer.
- **Approve**: leave up to 3 days (manager) or longer (HOD); expenses up to ₹10,000 (team lead) / ₹50,000 (HOD); discounts up to 10 % (Sales Head).
- **SOP library**: edit steps, evidence rules and due times; start event SOPs (e.g. onboarding) by hand.
- **Exports**: Excel on every board; attendance and leave Excel for payroll (HR/admin).

## Technical Support
- **Service desk board**: New → Assigned → In progress → Waiting → Resolved. Every open ticket shows its SLA chip (time left / over). P1 cards have a red border; the clock on P1 never stops.
- **New ticket**: customer, subject, priority (P1 business stopped · P2 high · P3 normal · P4 low), channel. Assign now or leave in New for the huddle.
- Open a ticket (drawer): **Reply** (emails the customer and stops the response clock), **Phone call** / **Internal note**, **Start work**, **Waiting on customer**, **Escalate to dev** (creates a linked development issue; the ticket waits and comes back automatically when released), change assignee or priority (restarts the clock), **Resolve** (customer gets a one-click rating link). Reopen if the customer comes back; reopens count against the reopen rate.
- **Daily support huddle** SOP: review overnight tickets, assign every unowned ticket before 10:30, call back every P1 customer (call summary required), review tickets older than 7 days, confirm tomorrow's roster.
- Implementation tickets run on a day plan (default 21 days) instead of an SLA.

## Development and QA
- **Board**: backlog → planned → in progress → in review → in QA → ready → released, filtered by project, person, type and sprint. Cards show type, points, sub-task progress, linked tickets and due dates; blocked issues carry ⛔.
- **Issue**: description and acceptance criteria, estimate in points and hours, component, customer who asked, due date; move buttons; *Mark blocked* with a reason; plan into a sprint; set the release; sub-tasks; QA test cases (Pass / Fail — a fail sends the issue back to In progress and tells the developer); timer and logged hours; comments (assignee and reporter are notified); linked tickets.
- **Planning** (HOD / team lead): backlog, current sprint and next sprint side by side; *→ Current*, *→ Next*, *Backlog*. Start the sprint to record the commitment; close it on Friday — unfinished work carries over and is counted. The sprint page has the burndown and the Friday demo list.
- **Projects**: group issues under a product, customer implementation or internal project with owner and target date; health is on track / at risk / late from progress against the dates; a project page has its own board and releases.
- **Releases**: create a version, add issues from each issue's *Set release*, QA signs off, the Development HOD approves, *Ship it* releases every issue, returns linked tickets to support and generates release notes (copy button).
- **Metrics**: velocity, cycle and lead time, carry-over, open bugs and age, escaped defects (bugs raised by customers), QA first-pass rate, estimate accuracy, per developer and per type. Developers see only their own row elsewhere.
- Tickets escalated from support arrive in the backlog with the ticket's priority; developers' Service desk shows only those tickets.

## Sales and Pre-sales
- **Pipeline board**: New lead → Contacted → Qualified → Demo → Proposal → Negotiation → Won, with win chances and value totals per column; cards show days in stage (amber over 7, red over 14) and the next step with its date (red when overdue).
- **New lead**: customer (existing or new), what they are buying, value, source, next step.
- Open a deal: **Log an activity** (call, visit, demo, email, note; visits capture your location and the distance from your previous visit today), **qualification** (need, budget, timeline unlock Qualified), **quote and discount** (≤5 % no approval, ≤10 % Sales Head, above COO — requested automatically), **PO received**, and the stage buttons. 🔒 on a stage means an exit rule is not met; hover for which. **Won** creates the work order, an invoice request for Accounts and the implementation ticket in one go.
- **Monday pipeline review** SOP for the Sales Head: every open deal has a next step with a date; stuck deals reviewed; targets confirmed; lost reasons reviewed.

## Production
- **Production board** in English or हिन्दी (toggle at the top): Queued → In production → (QC) → Packed → Dispatched → Delivered. Red card = past the promised date; amber = due today.
- Open an order to move it. **Dispatch** needs the invoice number, courier and consignment number; take a photo of the packed goods with the phone camera. The customer is emailed the consignment number.
- **Dispatch checklist** SOP each day: plan against promised dates, invoice on every order, photo on every dispatch, customer notified.
- Design requests (from sales) land in the queue assigned to the mechanical engineer.

## Accounts and HR
- **Accounts**: invoice requests appear as tasks when a deal is won (due in 2 days); enter *Receivables overdue* and *Collections MTD* each Monday on their KPI pages; **Month-end close** SOP on the 1st.
- **HR**: People → add employees, edit reporting lines, reset passwords; Attendance Excel (People → export, or `/exports/attendance.xlsx?month=2026-11`) for payroll; leave quotas in Settings; **New-hire onboarding** SOP started from the library.

## New in 1.1
- **Import data** (managers; Settings → System → *Import data*, or Customers → *Import*): download the template for customers, leads, tickets or work orders, fill it from Tally/IndiaMART/Zoho/your Excel, upload, check the preview (rows with errors are flagged and skipped), confirm.
- **Procurement** (Production, Accounts, executives): items to buy with supplier, cost and needed-by date; *Forecast from pipeline* shows what is likely to be needed in the next 90 days (deals from Qualified onward, weighted by win chance, plus queued orders) with a *Plan item* button; *Material check* lists queued orders not yet marked ready. On a work order: *Ready* / *Short* / *Buy*.
- **Man-hours**: on a work order, *Start timer* / *Stop timer* or *Log hours* (managers can log for their team). Analytics → Man-hours shows hours by person and by item; Excel export.
- **Travel** (Pipeline → *Travel*): visits, km, estimated cost (₹/km in Settings), claims, deals won and cost per ₹1 L won, per salesperson; expense claims can name the deal and km.
- **Budgets** (managers): annual budget per department against approved expenses and purchases; the admin sets budgets; approvers see the remaining budget beside each expense or purchase request.

## Everyone
- **Request leave** / **Claim expense** from Today or Approvals; see where it is waiting under *My requests*.
- **My account**: change password, language, sign out of all devices.
- Press `/` anywhere to search tickets, deals, orders, customers and people; `Esc` closes a panel.

## New in 1.3 — pay, attendance, appraisals and hiring

### Payroll (HR, Accounts, executives)
1. **Salaries first.** Payroll → *Salaries* → *New*. Enter the annual CTC and the split fills itself in (basic, HRA, conveyance, special); adjust anything you like. Give the bank account, IFSC, PAN and UAN — the bank file and the PF return need them. A salary starts on a date: an old payslip never changes when you give someone a raise.
2. **Run the month.** Payroll → *New run* → pick the month → *Build*. You get a draft with every payslip, the gross, the deductions, the net and what the company pays on top. Read it, then *Approve*, then *Mark paid* once the money has gone.
   - A **draft** can be rebuilt as often as you like.
   - An **approved** run can be pulled back to draft with a reason.
   - A **paid** run is locked. A correction goes in the next month, the way an accountant would do it.
3. **Approval makes payslips visible** to the 44 employees, so read before you approve.
4. **Filing**: each run page shows PF, ESI, PT and TDS totals with the due dates, a NEFT **bank file** (`bank.csv`) and an Excel export.

> **Before the first live payroll:** Settings → *Statutory & payroll* holds every rate and slab — PF, ESI, Maharashtra PT and both tax regimes. Show that page to your CA, correct anything, and tick *"Our CA has checked these rates"*. Until that tick, every payslip carries a warning. LoyalFlow does the arithmetic; the rates are your company's responsibility.
>
> Run one month in parallel with PagarGuru before you switch. Compare the net pay column for all 44 people; they should match to the rupee.

### Attendance
- **Attendance** (everyone) shows your month day by day: present, late (and by how many minutes), on leave, absent. Managers get a team summary and can switch between their people.
- **Late and half days**: more than the grace period (15 minutes by default) is a late mark. Arriving after the half-day mark, or leaving that much early, counts as half a day for pay.
- **Correct a day**: *Correct a day* on the Attendance page — pick the date, say what the times should have been and why. It goes to your reporting manager under Approvals. The attendance record is written only if they approve.
- **Holidays**: Settings → *Holidays* — add the date and the occasion for the year. Holidays are not working days, so they never count as absent.
- **Missing records during roll-out**: a working day with no record counts as *present* by default, so nobody loses pay to a punch that was never made. When everyone is checking in reliably, turn that off in Settings → Statutory & payroll.

### Appraisals
- **For you**: Appraisals → *Mine*. Write your own review and rate yourself 1–5. Your KPIs for the year are shown beside the box — they are evidence for the conversation, not a score that decides anything.
- **For managers**: once your team member has submitted, you write yours and send it up.
- **For HODs**: set the **final rating** and the **increment you recommend**, with a note. It goes to the COO.
- **For the COO**: it arrives under Approvals like any other approval.
- **Applying a raise**: after approval, HR presses *Write new salary* and picks the month it starts from. Nothing changes anybody's pay on its own.
- **Probation**: a review appears three weeks before six months from the join date, assigned to the reporting manager, who confirms, extends or exits. Confirming makes the person permanent.
- **Starting a cycle** (HR): Appraisals → *New cycle* → name it and set the period and the two due dates. It is created as a **draft** — nobody is asked for anything. *Open the cycle* creates a review for everyone and asks each of them for their self review.

### Hiring (LoyalHire)
- **Raise a role**: Hiring → *New requisition*. The justification is what the COO reads, so write it properly. Saved as a draft; *Send to COO* puts it under Approvals. **Nobody can be added to a role until the headcount is approved.**
- **Candidates** are people, not rows per job. If you add someone we have already spoken to, LoyalFlow says so — open the existing record and put them on the new role instead of making a second one.
- **Stages**: Applied → Screening → Interview → Offer. Nothing moves on its own.
- **Interviews**: *Schedule interview* on the application; pick the round, the time and the panel. If somebody on the panel is already booked, you are told who and when, and you can still go ahead deliberately.
- **Scorecards**: every interviewer writes their own — five areas out of 5, a recommendation, and **what the candidate actually said or did**. You cannot see anyone else's until the whole panel has submitted. That is deliberate: the first opinion in the room should not become everyone's. HR can open them early for a calibration meeting.
- **A low score rejects nobody.** To close an application you choose the outcome and write the reason, and your name goes on it.
- **Offers** are drafted by HR, approved by the COO, and then **issued by hand**. Approval sends nothing to anybody. Record the answer when it comes; an acceptance marks the person hired and closes the role when the last position is filled.
- **Onboarding**: from an accepted offer, *Create employee* makes the employee record on probation and opens an onboarding task. Set their salary in Payroll before the first run.

### Who sees what
| | Payroll | Attendance | Appraisals | Hiring |
|---|---|---|---|---|
| Everyone | own payslips, own tax declaration | own month, ask for corrections | own review | only a hire they are on a panel for |
| Manager / team lead | — | their team | their team's reviews | a hire they manage |
| HOD | — | their department | moderation, final rating and increment | their own roles |
| HR and Accounts | everything | everything | everything | everything |
| COO / CEO | everything, approves runs | everything | approves ratings and increments | approves headcount and offers |
