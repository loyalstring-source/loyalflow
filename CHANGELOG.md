# Changelog

## 1.26.0 — 25 Nov 2026
Expenses go on to Accounts: reimbursements, advances and advance settlements, with documents and a ledger.
- **New tab: Home → Expenses.** Three things a person can raise: **Claim an expense** (reimbursement), **Ask for an advance**, and **Settle an advance** with bills. Each goes to the same approver as before (team lead, head of department or COO by amount).
- **After approval it goes to Accounts.** The Accounts team is notified and the item appears on the new **Accounts desk** under "To pay". Accounts records the payment with date, how it was paid (bank transfer, UPI, cash, cheque) and the transaction number, and can attach the payment proof. The item is then marked **Paid** and the person is told.
- **Advances.** An approved advance is given by Accounts and stays open against the person. They submit bills against it; once approved, the bills reduce what they hold. Accounts records unspent money returned, or pays the difference when more was spent than advanced. The advance closes as **Settled** when the two sides match. A person may have at most three advances open.
- **Supporting documents.** Bills, receipts and payment proofs (PDF or photo, up to 5 MB) attach to each claim, by the person or by Accounts. A reimbursement cannot be paid without a bill. The files are kept outside the public uploads folder and open only for the person, their managers, the approver and Accounts.
- **Ledger.** Every amount approved, paid, advanced, accounted for or returned is one line, with how and the reference. Each person has a running balance: above zero they hold company money, below zero the company owes them. A recorded line cannot be edited.
- **Nothing goes through payroll.** Reimbursements and advances are paid directly by Accounts and never appear on a payslip.
- **Four reports for budgeting** (Reports → Finance, all export to Excel): Expense and advance ledger; Approved and waiting to be paid; Advances given, accounted for and outstanding; Money paid out month by month (reimbursements, advances, returns, net cash out, and expense booked).
- **Spend figures corrected for advances:** an advance is not counted as spend until its bills are accepted. Budgets, the company overview and the expense reports follow this.
- Claims approved before this version appear under "To pay" until Accounts marks them paid.

## 1.25.0 — 25 Nov 2026
Drag and drop on the boards, assigned work on the home page, and the COO's new email.
- **Drag and drop on the Support and Development boards.** Drag a ticket or a board item to another column to move it. A small box asks for an optional remark and then moves it. The remark is kept on the ticket's history or the item's comments.
- **Remark button on every tile.** Press it to write a remark without opening the ticket or item, or to choose a column to move to. On a phone, where dragging is not available, this is how a tile is moved.
- Rules stay as they were: a ticket cannot be dragged back to New; dragging to Resolved resolves it and starts the customer's rating link; dragging a resolved ticket back reopens it; a ticket nobody holds is assigned to the person who moves it; the Development board refuses moves its rules do not allow and says why.
- **Home page: "Assigned to you".** Every person's home page lists their pending tasks, today's daily-review lines, tickets and board items, with Start on each and what they are working on now.
- **The COO's sign-in email is now sridhar.ngowda@loyalstring.com.** An existing system is updated when it restarts; the password does not change.

## 1.24.0 — 25 Nov 2026
- **New report: "Time spent on each task"** (Reports → Show as a list → Daily review, the "Time by task" button on Team at work, or `/reports/time-by-task`). One line for every task, daily-review line, ticket or board item that someone timed: the person, the team, the task, how many times they worked on it, first started, last worked, hours worked, break hours and number of breaks during it, and its status now. Totals on top, a chart of hours by task, the usual period buttons, filters by team and person, and Export to Excel.
- Clicking a name opens "What each person did" for that person, with each session and break listed by time.
- Demo data now includes timed sessions and breaks for Development, Support and QA.

## 1.23.0 — 25 Nov 2026
Work in hand: pending work, a running timer, breaks, and a live view for leads.
- **Tasks is now "My work".** One list of everything waiting for a person: tasks given to them, today's daily-review lines, tickets assigned to them and development board items. Each shows who gave it, when it is due and the time already worked.
- **Start, and the timer runs.** Pressing Start on an item shows "Working since …" with a running clock. A person works on one item at a time: starting another stops the first.
- **Breaks.** "Take a break" (Lunch, Tea, Personal, Meeting, Other) pauses the work and times the break; "Back to work" resumes the same item. The page shows hours worked and break time for the day.
- **Team at work** (button on My work, or `/tasks/team`). Team leads see their people; the COO, CEO and administrators see everyone, with a team filter. For each person: working, on a break or not on a task; what they are on and since when; hours worked; breaks; first start; pending items and how many are overdue. Opening a person shows the day session by session and their pending list. It refreshes every minute, and earlier days can be opened.
- **Anyone can give or pass on a task.** "New task" can be for yourself or anyone in your own team (managers: anyone who reports to them). "Pass on" hands one of your tasks to a team-mate with a reason; they are notified, and so is the person who gave it to you.
- A timer left running is counted for at most 10 hours and a break for at most 3. Finishing or passing on a task stops its timer.
- The report "What each person did" gains hours timed on tasks and break hours, and lists each work session and break for one person.

## 1.22.0 — 25 Nov 2026
New sign-in page.
- **The sign-in page follows the new design:** a company bar with the Loyal String logo, "LoyalFlow" and "Workforce Management"; "Sign in to LoyalFlow" on the left; "The future of work flows together." with Vision 2030 and the flowing ribbons on the right; "Loyal String International" at the foot. The reset-password pages use the same frame.
- **Show password:** the eye in the password box shows or hides what was typed.
- **Remember me:** when ticked, the sign-in is kept on that device for 14 days as before. When not ticked, the browser forgets it when it is closed.
- **Need help signing in?** opens a short note on resetting a password and whom to ask.

## 1.21.0 — 25 Nov 2026
One report for what every person did, and the Loyal String logo throughout.
- **New report: "What each person did"** (Reports → Show as a list → Daily review, or `/reports/emp-activity`). One line per person for the period: days at work, days late, hours at work, daily-review lines planned and done, hours logged, tickets closed, deals won and their value, money collected, customer contacts, development items released and checklists completed.
- **Click a name to see everything that person did, entry by entry**, newest first: when they came in and left, each daily-review line or work-log entry, collections, tickets closed, deals won, customer calls, visits and demos, development items released, checklists completed, approvals decided and timed work.
- **Period buttons on every report:** Today, This week, This month, Last month, Last 3 months, Last 6 months, This financial year, Last 12 months. Any other dates can be typed in.
- **Export to Excel** downloads exactly what is on screen, for the whole company or for one person.
- Managers see only their own people. Employees who manage no one cannot open the report.
- **Logo:** the Loyal String mark replaces the shield-and-rings logo on the sign-in page, the top bar, the browser tab and the phone app icon. Estimates already carry it.

## 1.20.0 — 25 Nov 2026
Reports seen from above, in 3D.
- **Reports opens on a view of the company from above** for executives, administrators and anyone who leads a team. Each team is a group of blocks on the floor with a pulsing marker over it. The marker is green, amber or red for the team's outlook this month, and the number on it is how many items need attention. Each block is one of the last four weeks against target.
- **Click a marker and a panel opens at the side** with the team's figures against target, a three-dimensional bar chart, what needs attention, and the team's reports. Every bar carries its figure. Esc or the cross closes the panel.
- Before anything is clicked, the side shows "Where to look first": teams in order, worst first.
- **"Show as a list"** opens the plain list of all reports as before; "View from above" comes back. Reports opened from a module's own menu stay a list. Managers see only the teams they lead. Everyone else keeps the list.
- Works on a phone (the panel opens under the floor) and from the keyboard.

## 1.19.3 — 25 Nov 2026
- **Estimates carry the new monochrome Loyal String logo** in place of the red and blue one. The LoyalFlow logo elsewhere is unchanged.

## 1.19.2 — 25 Nov 2026
- **Daily review: a confirmed amount now shows at once.** Typing a figure in "Confirmed by lead" saved it only after leaving the box, and the totals at the top did not change until the page was reloaded, so it looked as if nothing had been saved. Each line now has a **Save** button (Enter also saves), and the totals, the person's line and the status refresh straight after. The same applies to a person's own update.
- The sideways scroll bar under each person's lines is gone.

## 1.19.1 — 25 Nov 2026
- **Fix for the build on the server.** `npm run build` stopped with three type errors in `src/routes/brief.ts` and `src/routes/today.ts` (the overview page's reply type was not imported). The build now completes. Nothing changes on screen.

## 1.19.0 — 24 Nov 2026
Estimates in the company's own format, and an hour-by-hour work log for Accounts.
- **Estimates now print like the company's existing estimates.** Loyal String logo, "Loyal String International Pvt. Ltd.", the Bhosari address, email, website, phone and GSTIN at the top; Estimate number, date and valid-until; Place of supply and Sales person; Bill To; items with HSN/SAC, quantity, rate, amount, taxable amount and the tax columns; Sub total, Total and Total in words; Notes, Company bank details, Terms and conditions and Authorized signature. The customer's link shows the same page.
- **Place of supply decides the tax.** Choose the customer's state on the estimate: Maharashtra gives CGST + SGST, any other state gives IGST.
- **Company details are filled in by default** and can be changed under Sales → Estimates → Settings (website, note, bank details, and whether to show the logo).
- **Hour-by-hour work log** as a new daily-review style, switched on for Accounts. The person logs what they did against the time they did it (from, to, what). Entries cannot overlap, run past four hours or be in the future. Nobody accepts or closes their own log: for Accounts, an executive or administrator does it.
- The home page shows "Your work log today" for people on this style, and after midday the company overview flags anyone who has logged nothing.
- Any team can be moved to this style under Daily review → Meeting style for each team.

## 1.18.0 — 24 Nov 2026
Readiness check before hosting, and a fuller demo.
- **Every screen checked as every kind of user.** A new check (`node tests/crawl.ts demo` or `real`) signs in as 11 kinds of people and opens every link the screens offer: about 6,000 page loads on demo data and 5,400 on an empty real system. It found no crashes. It did find links that led to "not allowed" pages; those are fixed:
  - A KPI's "look at one department" list now shows only the departments you may open, and the "Company page" button appears only if you may open it.
  - On a person's profile, the open tickets and open deals figures link only if you have Support or Sales; HR can open the detail behind a person's KPI tiles.
  - People who are not on any interview panel now get an explanation on Hiring instead of an error.
  - HR and Accounts are told where statutory rates are set instead of being sent to a page they cannot open; HR can open their own draft payslip.
- **Type check is clean** and the four browser tests left behind by the redesign are updated. All 174 tests and 18 browser tests pass.
- **Demo data for the newer screens** (demo mode only, never on a real system): six sample products and an estimate sent to a customer; eight working days of daily review for Development, Support and Sales; six months of history so month-by-month graphs have a shape; monthly targets set so the overview shows a mix of outlooks; attendance filled up to today each time the demo starts.

## 1.17.1 — 16 Nov 2026
Graphs at the top of the overview.
- **One graph card per team, first thing on the page**, in the chart-wall format: team and title, "Open report", a headline figure with its outlook, the chart and a legend.
  Sales: won and collected by month. Support: tickets opened and closed. Development and other daily-review teams: tasks done against planned for the last seven working days. Production: orders dispatched and how many on time. People: at work each day this week. Hiring: candidates at each step. Accounts: spend by month.
- Teams with nothing to draw yet are named in one line under the graphs instead of showing an empty card.
- What needs attention and the one-line-per-team table follow below. The separate "Money this month" card is gone because the Sales graph shows it.

## 1.17.0 — 16 Nov 2026
Company overview for the people who run the company, with monthly targets.
- **Company overview is now the home page for executives and administrators.** It opens on what needs attention (worst first) and one line per team: this month so far, progress against target, the last 8 weeks, today's daily review and a status. Their own day (check-in, tasks) moves to the "My day" tab.
- **Three views that change by themselves**, one minute each by default: Today, This week (against last week, day by day) and This month (target, achieved so far, projected month-end figure and outlook such as "Will meet" or "Short by ₹3.8 L"). Pause, jump to a view, or go full screen for a wall display. Figures refresh after each round.
- **Team managers get the same page for their own teams** under Home → Team overview.
- **Settings → Targets.** One monthly target per measure. The team's head or team lead sets it; a target not set for a month carries on from the month before. Administrators and executives can let more people set targets, for one team or all, and choose how long each view stays.
- **Settings → Administrators.** An executive or administrator can make any person an administrator, who can then manage everything (settings, roles, targets, every team) without involving the executives.
- Measures: Sales won, Collections (from the Sales daily review), Tickets closed in promised time, Orders dispatched on time, Roles filled, Attendance, Spend against budget, and "Daily tasks done as planned" for every other team that holds a daily review.
- **Fix:** unfinished daily-review lines were being carried to Sunday when a Saturday was closed. They now go to the next working day as intended.

## 1.16.0 — 12 Nov 2026
Daily review (DSR) for every team.
- **Home → Daily review**: one sheet per team per day. The team lead plans it in the morning, each person updates their own lines during the day, and the lead confirms each line and closes the day in the evening.
- **Each team runs it its own way** (Daily review → Meeting style for each team; administrators and executives):
  - *Tasks for the day* (Development and most teams): tasks with planned hours, free text or picked from the board; marked done, partly done with a percentage, not done or blocked, with a remark.
  - *Collections expected today* (Sales): customer and amount expected in the morning; amount received in the evening; the sheet shows expected, collected and still to come.
  - *Tickets and follow-ups* (Support): yesterday's new tickets, everything pending oldest first, and implementations under way, with follow-up tasks per person that can point at a ticket.
- **Closing the day** keeps it as the record. A line nobody reviewed takes the person's own update, or counts as not done. Unfinished lines move to the next working day (for collections, only the balance) unless set to Drop, and show how many times they have been brought forward. A lead can reopen a day.
- "Confirm from own updates" accepts everyone's own update in one click; the lead then changes only the ones that differ.
- People see "Your day plan" on their home page and get a notification when the lead adds a line or closes the day.
- Two new reports under Company → Reports: Daily review by day, and by person.

## 1.15.2 — 12 Nov 2026
New logo.
- **Shield, linked rings and RFID waves** (option S6) replaces the black-and-gold rings: the shield for security, the rings for people working together, the waves for RFID. Navy and blue with one gold ring.
- The name is now set as **LoyalFlow** in the same typeface as the rest of the app, with "Flow" in blue; larger in the top bar.
- The sign-in page side panel and the app icon moved from black to navy to match.

## 1.15.1 — 12 Nov 2026
Reports are easier to read at a glance.
- **Headline tiles** at the top of every report show the totals (for example Won, Won value, Win rate) in large figures.
- **Month reports draw as columns**, left to right, with the value above each month; other reports keep bars and now show each line's share of the total.
- **In the table**, percentages carry a small meter and the main count or amount column is lightly shaded by size, so the biggest lines stand out.
- Hovering a bar or column highlights it and shows the exact figure. Excel export is unchanged.

## 1.15.0 — 12 Nov 2026
Reports for every module.
- **A Reports tab in every module** (Sales, Support, Development, Production, People, Company) and one page, Company → Reports, that lists every report a person may run.
- **38 reports**, all with a date range (and quick choices: this month, last month, last 3 months, this financial year, last 12 months), most with department and person filters, a chart, a totals line, Print and **Export to Excel**.
  - Sales: won and lost by month; by person; why deals were lost; stage by stage; estimates sent and accepted; by product; by source.
  - Support: by customer; by type and priority; by person; repeat problems; customer ratings; implementation timelines.
  - Development: release history; work by project; bugs.
  - Production: on-time dispatch by month; time in each stage; late orders.
  - Finance: expenses by category and by person; purchases by supplier; budget against spend.
  - Attendance and leave: attendance summary; late arrivals; leave taken and balance; miss-punch requests.
  - Hiring: time to hire; candidates by source; where candidates drop off; offers.
  - Appraisals: ratings by department; increments; probation reviews due.
  - SOPs: checklist compliance; checklists by person. Approvals: how long approvals wait. Administration: who changed what (Settings → Change history).
- **Who sees what:** a report shows only if the person's role includes that module. Team leads see their own team; a sales person sees their own deals; people with company-wide access, and the managers of a module, see everyone.
- Code: `src/modules/reports/engine.ts` (one definition per report), `src/routes/reports.ts`, `src/ui/pages/reports.ts`.

## 1.14.0 — 12 Nov 2026
New look across the whole app (the "Final set" chosen on 12 Nov 2026).
- **Top bar instead of the side menu.** Logo, search, notifications and your account on the first row; the all-modules button, the module name and that module's tabs on the second. Modules: Home, Sales, Support, Development, Production, People, Company, Settings. What a person sees still follows their role.
- **One style on every page:** light grey page, white cards with a thin border, 13px text, blue for links, primary buttons and the active tab, colour otherwise only for status. The logo keeps its black and gold.
- **Every page opens with a header card:** a square icon for the module, the title, a line of key facts, and the actions on the right.
- **Home:** the header is the greeting with what is waiting for you and the Check in button; approvals come first; a "Your apps" card opens each module.
- **Deal page:** stages are an arrow bar (done, now, next) you can click; details on the left; activity and the customer on the right. The development issue page uses the same stage bar.
- Tables, boards, forms, tabs, status labels, drawers and the phone layout restyled to match. Estimates, Products and Customers are now tabs of Sales; Lists and Roles are tabs of Settings.
- No change to data, permissions or behaviour. `public/theme.css` is the single place the look lives; the old black-and-gold theme is replaced.

## 1.13.0 — 11 Nov 2026
Sales: product catalogue and estimates.
- **Products** (Pipeline → Products): name, picture, description, unit, price before GST, GST rate, HSN/SAC. Sales managers add and change them; a product can be retired without touching old estimates.
- **Estimates** on a deal: lines picked from the product list (or typed by hand) with quantity, unit, rate, discount % and GST % on each line; live totals; CGST + SGST for the same state or IGST for another state.
- Draft → finalise (fixes the figures, sets the deal value and discount, and sends a discount above the limit for approval) → send (a link the customer opens without signing in) → accepted or declined, by the customer on the link or recorded by the sales person. A change after finalising is a new version; the old one is kept.
- The customer page and the staff page both print cleanly; "Print or save as PDF" uses the browser.
- Company name, address, GSTIN, validity days, terms and bank details for estimates are set on the Products page. Units and GST rates are lists under Settings → Lists and options → Sales.
- The Proposal stage now needs a finalised estimate (or the quick figure, kept for deals with no product list).
- Estimates list (Pipeline → Estimates) with search, status filter and paging.
- Database: migration `0013_estimates` (tables `products`, `estimates`, `estimate_items`; `customers.address`, `customers.gstin`). Zoho Books ids are stored on products and estimates, ready for the Zoho link; nothing is sent to Zoho yet.

## 1.12.0 — 11 Nov 2026
Roles and permissions.
- New screen **Settings → Roles and permissions** (`/roles`). A role sets, module by module, how much a person can do (No access, By link, View, Work, Manage) and whose records they can open (own, team, everyone).
- Everyone starts on the automatic role for their department and level, which gives exactly the access they had before (checked for every person and every action by an automated test). Automatic roles can be edited and put back.
- Your own roles: create (from scratch or as a copy), give to particular people, delete. "Who has which role" lists everyone with search and paging; "What can they do?" shows one person's access in plain words.
- The menu and the server-side page check now follow the role. HR's restriction is now simply the HR role.
- Hiring, attendance rules, appraisal cycles, payroll and the Lists screen now follow the role instead of the department code.
- Administrators can always do everything, so the company cannot be locked out. The named Sales Head and Production HOD keep their rights.
- Every change to a role, and every change of a person's role, is in the audit trail.
- Database: migration `0012_roles` (table `roles`, column `employees.role_id`). Applied automatically on start.

## 1.11.0 — 11 Nov 2026
Lists and options: the choices in every module are now settings.
- New screen **Settings → Lists and options** (`/lists`), one tab per module. Every change is recorded and each list has a Reset.
- Organisation: add and rename departments (head, shift, dashboard group) and sites.
- Sales: lead sources, lost reasons, stage names and win chance, currencies, call outcomes.
- Support: priority names, ticket type names, ticket channels.
- Development: issue type names, board column names, project kind names.
- Production: stage names in English and Hindi.
- Finance: expense categories.
- Attendance and leave: leave types with days per year (new types can be added), miss-punch reasons.
- Hiring: candidate sources, stage names, interview kinds, scorecard areas, work modes, onboarding checklist (gate steps cannot be switched off), limits for bulk CVs and English test batches and link life.
- Appraisals: rating names, probation length.
- HR can change the Attendance and leave, Hiring and Appraisals tabs; executives and admins change all.
- Leave quota moved from Settings → SOPs to the leave types list (existing numbers carried over).
- Fixed: the Statutory & payroll tab in Settings did not open.
- `GET /api/v1/today`: `leave` is now a list of `{code, label, quota, used}`.
- Scale check script `tests/scale.ts` (1,000 employees, a year of attendance).

## 1.10.0 — 11 Nov 2026

**Attendance: punching machine, two-step miss-punch and leave, the late rule, and a quieter look.**
- **Late rule, set by HR.** Arriving within 15 minutes of shift start is on time. Later than that is a late arrival; three are tolerated in a calendar month; from the fourth, each late arrival makes that day a half day. All three numbers are settings under Attendance → Rules, with a history of changes. Each person sees "Late arrivals this month: 2 of 3 allowed".
- **Miss-punch requests in two steps.** The reporting manager (team lead) validates, then HR approves; both must write a comment. Attendance changes only after HR approves. No cap on requests; the window (7 days) and the flag level (3 in a month) are settings.
- **Miss-punch report** (Attendance → Miss-punch report): by person, team and period — requests, approved, declined, usual reason, who validated, who approved, their comments; people flagged; approvers who never decline. Download for Excel. HR and executives see everyone; a manager sees their team.
- **Leave in two steps.** Reporting manager first, HR final. The balance and the attendance sheet change only after HR approves. A decline needs a reason.
- **Punching machine.** ZKTeco machines can push punches to LoyalFlow over the internet (their push / ADMS protocol): HR approves each machine by serial number and gives each person their machine user ID. First punch of the day is IN, last is OUT. Raw punches are kept. A punch file exported from the machine can be uploaded instead. Punches from IDs with no person wait and are attached when the ID is linked.
- **Quieter look.** One typeface, black, white and one gold, colour only for status, thin lines instead of shadows and filled blocks, smaller corners, lighter weights.
- Migration `0011_attendance_machine`. 130 automated tests.
- Not verified: a real ZKTeco machine (none available to test with; written to the published protocol). The machine can reach the app only once it is hosted or on the same network.
- Not built: sending leave to the next manager when the first does not act.

## 1.9.0 — 11 Nov 2026

**LoyalHire: faster sourcing and screening.**
- **CV upload and summary.** Upload a PDF or Word (.docx) CV on a candidate. The system reads it and fills the summary, skills, education and most recent job; HR can edit the summary. Empty fields on the candidate (phone, company, experience, location) are filled; anything HR typed is kept.
- **Reading by Google Gemini (optional).** Paste an API key under Hiring → Settings. PDFs are sent as the file, so scans can be read. The key is stored encrypted and never shown again. Without a key, CVs are read by simple rules inside the app (Word files and plain PDFs; not scans). If Gemini fails, the rules take over and say so.
- **Bulk upload.** From a vacancy, "Upload CVs" takes up to 20 files, shows what was read in an editable table with duplicate warnings, and creates only the rows HR ticks.
- **Assessment link shared by hand.** "Get link" on an invitation shows the candidate's link to copy and send yourself. Each time it is shown is recorded. Invitations no longer need email to be set up.
- **Screening questions with points.** A default set of nine questions; each is scored on the application with a note. Total and missed must-haves show on the application and in the vacancy pipeline. Questions are edited under Hiring → Questions, for the company or for one vacancy; editing makes a new version and old scores keep theirs. A score never rejects anybody.
- **Interview plan.** Each vacancy has an ordered plan (default: HR, team manager, COO, CEO) that can be changed freely. The application shows where the candidate is, and "Schedule" on the next round fills in its name and interviewer. Nothing is enforced.
- Migration `0010_loyalhire_sourcing`. 121 automated tests and 36 browser checks.
- Not verified: a real call to Gemini (no API key yet; the request follows Google's published format).

## 1.8.1 — 11 Nov 2026

**Fix: forms in Hiring, Assessments and Appraisals did not send what was typed.**
- Cause: these forms were sent by a click anywhere inside them, with no fields, instead of by their Save button. "Add candidate" answered "The candidate needs a name" whatever was typed. The fault dates from v1.3 and affected all 22 forms in those three areas (new vacancy, add candidate, schedule interview, scorecard, offer, hold, decision, review, appraisal steps).
- Fixed in one place (`public/app.js`): such forms are now sent on submit with their fields. Cancel buttons in those dialogs now close the dialog. Ticked lists (interview panel, batch applicants) are sent as lists.
- Why the tests missed it: they posted data straight to the server and never used the form. Added `tests/browser/hire-walkthrough.cjs`, which fills in and submits the hiring and assessment forms in a real browser (29 checks).

## 1.8.0 — 11 Nov 2026

**LoyalHire, step 2 of 3: the Workplace English assessment.**
- **Two tests, A2 and B1,** written for LoyalFlow: a reading passage with 5 questions, 10 language-at-work questions and one short piece of writing. 25 minutes. In-house content, not a formal CEFR certificate.
- **Invitations:** one candidate from their application, or a batch of up to 20 active applicants from one open vacancy with one level and one expiry (1 to 14 days). Reissuing cancels the earlier link.
- **Candidate page** (no sign-in, private link): instructions first; the timer starts only on Begin; answers save as they go and resume on the same link; one submission; when time runs out, what was saved is submitted. The candidate is never shown a score. Works on a phone.
- **Scoring:** multiple-choice items are scored by the system. The writing is scored by HR on five parts (0 to 4 each) with an outcome for the role. The result is advisory: it never moves, ranks or closes an application.
- **Assessments queue** (Hiring → Assessments): filter by vacancy, status and name; email status; scores; what is waiting for review; pilot summary by level.
- **Email through Microsoft 365 (Graph).** States are kept apart: accepted (not proof of delivery), failed, and uncertain (never retried automatically). Reminders 48 hours after an accepted invitation and 24 hours before expiry, only while the candidate has not started. Every message is logged on the application.
- **Link safety:** only a hash and an encrypted copy of the link are stored; neither appears on any HR page.
- **Without Microsoft 365 settings** invitations are switched off, except in demo mode, where nothing is emailed and HR gets an "Open candidate link" button for testing.
- New settings: `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET`, `GRAPH_SENDER`, and optional `ASSESSMENT_LINK_SECRET`.
- Migration `0009_loyalhire_assessment` adds two tables. 109 automated tests.
- Not verified: a real send through a Microsoft 365 tenant (no credentials yet).

## 1.7.0 — 11 Nov 2026

**LoyalHire, step 1 of 3: the workflow core, to the Developer Specification v1.0.**
- **Approval moved outside the app.** A vacancy is a draft until HR opens it with an approval reference ("Approved by COO, email of 3 Nov"). Offers are drafted and issued by HR by hand. Nothing goes to the Approvals inbox any more; approval tasks raised earlier are withdrawn and vacancies or offers that were waiting return to draft.
- **Stages:** Applied, Screening, Assessment, Interview, Decision, Offer, Onboarding, Hired. Offer, Onboarding and Hired are never reached by moving a card.
- **Hiring decision** is its own record (Hire, Hold or Reject, with reasons, who and when, and the scorecards it rests on). Hire moves the application to Offer and needs at least one submitted scorecard.
- **Hold** keeps the application open with a reason and a follow-up date; the Hiring page lists holds and flags overdue ones. Closing outcomes are Rejected, Withdrawn and No show; HR can reopen with a reason.
- **Vacancies** can be paused and resumed; closing asks whether to keep or close the applications still in play. Work mode and target date added.
- **Offers:** Draft, Issued, Accepted, Declined, Expired, Cancelled. An issued offer past its validity date expires.
- **Onboarding checklist** starts when an offer is accepted. A person becomes Hired only when onboarding is completed, which needs the employee record, "Training completed" and "Training assessment started".
- **HR access:** HR accounts reach Today, Company KPIs, People, Attendance, Appraisals, Hiring, Payroll, Approvals, Tasks and SOPs only. Service desk, Development, Pipeline, Production, Procurement, Budgets and Analytics are closed to them in the menu and on the server; search returns people only.
- Database migration `0008_loyalhire_workflow` runs by itself on start and only adds tables and columns.
- Not yet built (steps 2 and 3): the Workplace English assessment, message log, question bank, calendar screen and reports.

## 1.6.0 — 11 Nov 2026

**New logo and colours.**
- Logo: the Loyal Flow rings (two woven rings, one gold) with the wordmark in Playfair Display; "Vision 2030" line on the sign-in page. Replaces the blue "LF" square everywhere, including the browser tab and app icons.
- Theme: black sidebar, warm off-white pages, gold as the action colour (primary buttons, focus, active navigation). Red, amber and green remain reserved for status.
- Colour: navigation icons and card headings carry the module colours; the Today and Company hero panels are black with a gold glow.
- Fonts (Playfair Display, Sora, Plus Jakarta Sans) load from Google Fonts; without internet the app falls back to system fonts.
- All in one new file, `public/theme.css`, loaded after the existing styles. No data or behaviour changes.

## 1.5.2 — 2026-11-10
- **Fixed: `npm run seed:demo` and `npm run demo` did nothing on Windows.** Both scripts began with `LOYALFLOW_DEMO=1 node ...`, which is Unix shell syntax; on Windows `cmd` it fails with "not recognized as an internal or external command", so the command errored and no demo data was ever loaded. The demo flag is now `--demo`, which behaves the same on every platform, and `LOYALFLOW_DEMO=1` still works where the shell supports it.
- `npm run seed` now says plainly when it has loaded no demo data, and how to ask for it, instead of finishing silently.

## 1.5.1 — 2026-11-10
- Hiring now gets real volume from `seed:bulk`: 10 requisitions across the company at every stage (5 open, 2 awaiting the COO, 1 draft, 1 declined, 1 closed after a hire), with candidates spread across the open roles instead of all queueing for one job.
- 14 offers covering every state of the flow — drafted, with the COO, approved but not issued, out with the candidate, accepted and declined — so each button on the page has something to act on.
- The COO and the HR lead are put on upcoming interview panels, so whoever is testing sees interviews and scorecards of their own rather than an empty panel.
- Fixed: a notification's email callback wrote to the database after the process had closed it, crashing the CLI. It also had no error handler, so a failing mail server became an unhandled rejection. Both are now contained — the in-app notification is saved either way.

## 1.5.0 — 2026-11-10 (bulk test data)
- `npm run seed:bulk` fills every module with 50 or more realistic records: 70 jeweller customers, 106 deals, 262 tickets, 76 development issues, 74 work orders, 56 procurement items, 210 approvals (54 leave, 54 expense, 52 purchase, 50 discount), 60 tasks, 250 time logs, 83 SOP runs, 72 candidates, 60 applications, 51 interviews and 91 scorecards.
- Everything is backdated across about six months, so SLA clocks, ageing, trends and the red-streak callout all have real history. Roughly a quarter of the rows are deliberately awkward — breached, reopened, blocked, late, declined, withdrawn — because that is where the bugs are.
- 13 weeks of KPI history are rebuilt from the generated data, so every sparkline and trend line means something. Date-range KPIs are computed correctly per week; point-in-time ones repeat today's figure and say so.
- SOP runs are worked at about 78% compliance with a tail of late and missed steps, so the escalation chain is testable.
- The test suite keeps its own small deterministic dataset and is untouched by any of this.
- `docs/TESTING.md` gains a test path written for one person without a QA team.

## 1.4.0 — 2026-11-10 (Today and Company rebuilt: depth, motion and page morphing)
- A new motion and depth layer (`public/motion.css`), loaded after `app.css` and entirely additive — remove the one `<link>` and the app returns to 1.3 exactly.
- **Today** rebuilt: an aurora hero with a live clock, the check-in as a tactile press with a drawn checkmark and a particle burst, quick actions as floating cards with a hover sheen, staggered card and row entry, leave balances as small meters, and a proper empty state for a clear day.
- **Company** rebuilt: a "where we stand" hero that states the position in one line with a green/amber/red bar, bands as labelled sections rather than plain cards, and every tile carrying a coloured status edge.
- **Tile to detail is now a morph, not a page load.** Each KPI tile and the big number on its detail page share a `view-transition-name`, so the browser interpolates one into the other across a real navigation. No framework, no JavaScript — the same technique Framer Motion's `layoutId` provides, done natively and across documents.
- Sparklines and progress rings draw themselves in; numbers count up to their value; buttons show a spinner in place rather than shifting the layout.
- `prefers-reduced-motion` disables all of it, including the view transitions.
- Fixed: offer and appraisal approvals were created with the `discount` task type, so the approvals list rendered a ₹4,70,000 offer as "470000%".
- Fixed: a side panel closed while its contents were still loading could reopen when the slow response arrived.
- Fixed: sections below the fold were revealed only by scrolling, so they were blank when printing or capturing the page. They now reveal on print, and unconditionally after a moment, whatever the observer does.

## 1.3.0 — 2026-11-03 (Phase 4: payroll, attendance, appraisals, LoyalHire)
- **Payroll** replaces PagarGuru. Salary structures are effective-dated, so an old payslip never changes when a salary does; a CTC can be split into basic / HRA / conveyance / special with one click. Monthly run: build a draft, read every payslip, approve, mark paid. A draft can be rebuilt as often as you like; an approved run can be pulled back; a **paid run is locked for good** — corrections go in the next month.
- Statutory: PF (12% / 12% with the ₹15,000 ceiling, EPS 8.33%, admin and EDLI 0.5% each), ESI (0.75% / 3.25% below the ₹21,000 gross ceiling), Maharashtra professional tax including the February top-up and the separate slabs for women, and TDS under both the new and the old regime with section 87A, HRA exemption and 80C / 80D / 80CCD(1B). **Every rate and slab is editable in Settings → Statutory, and every payslip carries a warning until your CA has ticked "we have checked these rates".**
- Payslips: printable, amount in words, year-to-date column. Employees see only their own, and only once the run is approved. HR and Accounts see everyone. Per-run PF, ESI, PT and TDS challan totals, a NEFT bank file and an Excel export.
- Employees can file a tax declaration (regime, 80C, 80D, 80CCD(1B), home-loan interest, rent) and the next run uses it.
- **Attendance** is now complete: late marks against the shift, half days for a very late start or a very short day, a month sheet per person and a team summary, and the holiday calendar is editable per year. During roll-out a day with no record counts as present by default (Settings → Payroll) so nobody loses pay to a missing punch.
- **Attendance corrections**: an employee asks for a missed day within 45 days, it routes to the reporting manager as an approval, and the attendance row is written only when it is approved.
- **Appraisals**: yearly cycles created as a draft, opened to everyone at once. Self review → manager review → HOD moderation (final rating and recommended increment) → COO approval. KPIs from the KPI engine are captured when the cycle opens and sit next to the review as evidence — nobody is rated by a formula. HR applies an approved increment as a new effective-dated salary; nothing changes pay by itself.
- **Probation reviews** appear three weeks before six months from the join date. The reporting manager confirms, extends or exits; confirming makes the person permanent.
- **LoyalHire**: requisitions (with a justification that goes to the COO for headcount approval), candidates kept separate from applications with duplicate detection on email, phone and name, stage history with the workflow version each application started on, interviews with panel clash warnings, and offers.
- Hiring privacy: candidate records and CVs are open to HR and to the people actually working on that hire — the hiring manager, the recruiter, the owner and anyone on a panel. Everybody else gets a plain refusal.
- Scorecards: each interviewer writes their own with evidence, and **nobody sees anyone else's until the whole panel has submitted** (HR can open them early for calibration). A low score never rejects anybody: closing an application takes a named person and a written reason.
- Offers are drafted, approved by the COO, and then **issued by hand by a named person** — approval alone sends nothing. An accepted offer can be turned into an employee record on probation with an onboarding task.
- Fixed: a side panel closed while its contents were still loading could pop back open when the slow response arrived.
- Tests: 94 unit/integration + 18 e2e passing.

## 1.2.0 — 2026-11-03 (Development project management, focused navigation, visual refresh)
- Navigation is scoped: team members and team leads see their own module plus the shared pages (Today, Analytics, SOPs, Approvals, Tasks, People); HODs and executives see everything. Developers' service desk shows only tickets escalated to development (add `?all=1` to see all).
- Development: Projects (kind, owner, customer, start/target date, health on track / at risk / late, progress by issues and points, risks), Sprints (one week Mon–Fri, planning view backlog → current → next, start with commitment, close with carry-over, burndown, Friday demo list), Releases (version, QA sign-off by QA, approval by the Development HOD, ship = issues released + tickets back to support + generated release notes), issue detail (type, points, estimate, component, acceptance criteria, due date, customer, blocked with reason, comments with notifications, sub-tasks, QA test cases where a fail sends the issue back and notifies the developer, timer and hours, linked tickets).
- Development metrics page: velocity (8-week chart), cycle and lead time, carry-over, open bugs and age, escaped defects, QA first-pass rate, estimate accuracy, blocked count, per-developer table (managers) and per-type breakdown.
- Today for developers: "My sprint work" with one-click Start / To review / To QA; "New issue" quick action.
- Visual refresh: system typography (SF on Apple devices, Segoe on Windows), translucent sidebar and top bar, rounder cards without borders, segmented tabs, softer inputs and buttons, calmer kanban columns, refined drawers, modals and toasts. Google Fonts request removed.
- Demo data: three projects, last/current/next sprint, two releases (one shipped), comments, sub-tasks, QA tests and logged hours.
- Tests: 46 unit/integration + 10 e2e passing.

## 1.1.0 — 2026-11-03 (Phase 2)
- Import data: templates and upload for customers, leads/deals, open tickets and work orders (.xlsx or .csv), loose header matching, dd/mm/yyyy and Excel dates, validation preview, commit, history. Managers only.
- Procurement: items (planned → ordered → received) linked to work orders or deals, demand forecast for 90 days from qualified pipeline (weighted by win chance) and queued orders, material check on work orders (ready/short with note), "Buy" from the work-order panel.
- Man-hours: timers and manual hour logs on work orders (and tasks), Man-hours page by person and by item, Excel export.
- Sales travel: report per salesperson (visits, km, estimated cost at a configurable ₹/km, claims, deals won, open pipeline, cost per ₹1 L won), map links on visits, Excel; expense claims can reference a deal and km.
- Budgets: annual budget per department (admin sets), spent = approved expenses + purchases, waiting approvals shown, remaining budget shown to approvers and on the claim form.
- Settings: travel rate per km; Import data shortcut.
- Navigation: Procurement (production, accounts, executives), Budgets (managers), Travel from the Pipeline, Man-hours from Analytics links.
- Tests: 6 more (readers, import preview/commit, procurement and forecast, budgets and timers, travel report, HTTP flow). 40 unit/integration + 8 e2e passing.

## 1.0.0 — 2026-11-03
First complete release, built from the discovery of 1 Nov and the questionnaire answers of 2 Nov 2026.

- Platform: Node 22 + TypeScript (no build step), SQLite with migrations and nightly backups, server-rendered UI with progressive enhancement, PWA, JSON API.
- Modules: Today, Company page (16 tiles, exports), Analytics and KPI detail (32 KPIs, targets, proposals, manual entry), Service desk (SLA clocks, escalation, ratings), Development board, Pipeline (exit rules, quotes, discount routing, GPS visits, won hand-offs), Production (stages, dispatch evidence, Hindi), SOPs (checklists, evidence, escalation, compliance, editor), Approvals and tasks (leave, expenses, purchases, timers), People (directory, tree, profiles, HR admin, payroll exports), Settings (roles, SLA, shifts, holidays, thresholds, jobs, backups), notifications and email.
- Master data: 44 employees (LS001–LS044), 10 departments, 2 sites, 5 starter SOPs; optional demo data set.
- Tests: 16 unit, 18 integration (service flows and real HTTP), 8 Playwright end-to-end scenarios on desktop and phone; GitHub Actions CI with a Docker build.
- Deployment: Dockerfile, Docker Compose with Caddy (automatic HTTPS), `.env.example`, DigitalOcean guide, runbook, security notes.
