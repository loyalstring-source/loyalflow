# Testing

## What runs
| Suite | Command | Covers | Time |
|---|---|---|---|
| Type check | `npm run typecheck` | Whole code base under `strict` | ~10 s |
| Unit | `npm run test:unit` | Business-hour arithmetic (shifts, Sundays, holidays), ISO weeks and fiscal years, money formatting, password hashing and rules, HTML escaping, XLSX writer, permissions by role, scope, approval routing thresholds, KPI RAG/format/proration, SLA due dates and states, pipeline exit rules | ~1 s |
| Integration | `npm test` (unit + integration) | Full ticket life (create → assign → reply → escalate → release → resolve → rate → reopen), SLA warn/breach/auto-close with notifications, implementation plans, deal qualification → quote → COO approval → PO → won with work order + invoice task + implementation ticket, discount routing, visit distance, SOP generation/evidence/compliance/escalation ladder, event SOPs and versioning, leave/expense routing and decisions, timers, streaks, reporting-line validation; and over real HTTP: redirects/401s, login and lockout, CSRF (header, same-origin JSON, form field, cross-origin refusal), bearer API, forced password change, password reset single use, every page for every role (200/403/404), drawer fragments | ~5 s |
| End-to-end | `npm run test:e2e` | In a real Chromium (desktop and Pixel 7 emulation): sign in, raise a P1, reply, resolve with confetti, company page and KPI drill-down; COO approves from Today, sets a target, downloads Excel and PowerPoint; keyboard shortcuts and 404 page; BDM creates a lead, hits an exit rule, qualifies, quotes 14 % (approval), logs a GPS visit; support lead ticks an SOP step with evidence and requests leave; production lead switches to Hindi; IC is refused the company page; phone: no horizontal scroll, check-in, bottom tabs, manifest | ~40 s |

Run everything: `npm run test:all`. CI (`.github/workflows/ci.yml`) runs all of it on every push and builds the Docker image.

## Setup for the browser tests
```bash
npm install
npx playwright install chromium        # once; add --with-deps on a fresh Linux box
npm run test:e2e
```
The e2e config starts its own server on port 3100 with an in-memory database and demo data, so it never touches `./data`. Failures leave a screenshot and trace under `test-results/` (`npx playwright show-trace <file>`).

## Manual functional check (for the COO)
A suggested path through the demo data, 20 minutes:
1. Sign in as yourself (`sridhar.ngowda@…`). Today → approve the ₹62,400 expense and the 14 % discount.
2. Company page → note the red streaks → open *Overdue follow-ups* → see who owns them → *PowerPoint*.
3. Service desk → open the P1 (red border) → reply → resolve → watch it move to Resolved. Open a Waiting (Dev) ticket → see the linked issue.
4. Development → move the linked issue to *released* → back on the desk the ticket is *In progress* again.
5. Pipeline → *New lead* → try to move it to Qualified (locked) → record need/budget/timeline → quote with 12 % → the approval appears on your Today.
6. Production → switch to हिन्दी → open the late order → dispatch it with invoice, courier, consignment (and a photo from a phone).
7. SOPs → tick the huddle steps (one asks for a call summary) → *By person*.
8. People → open anyone → KPIs, SOP compliance, attendance → Edit → change their reporting line.
9. Settings → change the P2 response time → raise a P2 ticket → see the new due time.
10. Sign in on a phone as `nikita.kakade@…` → check in → tick steps → open a ticket from the bottom tabs.

## Manual checks for 1.3
11. Settings → *Statutory & payroll* → check every rate with your CA → tick *Our CA has checked these rates* → the warning disappears from payslips.
12. Payroll → *Salaries* → add a structure from a CTC → Payroll → *New run* for last month → compare the net pay of all 44 people against the PagarGuru run for the same month. They should match to the rupee before you switch.
13. Build → approve → mark paid → try to rebuild (refused) → try to reopen (refused, corrections go in the next month).
14. Sign in as an employee → *My payslips* → only your own, only approved months → file a tax declaration → rebuild the run → the TDS changes.
15. Attendance → *Correct a day* → sign in as the manager → Approvals → approve → the day appears on the sheet.
16. Appraisals → *New cycle* → *Open the cycle* → sign in as an IC and submit a self review → as their manager submit yours → as the HOD set a rating and increment → as COO approve from Approvals → as HR *Write new salary*.
17. Hiring → *New requisition* → *Send to COO* → try to add a candidate before approval (refused) → approve → add a candidate → schedule an interview with two people on the panel → submit one scorecard → sign in as the second interviewer: the first scorecard must be hidden.
18. As an unrelated colleague, open `/hire/candidates` and an application URL directly: both must be refused.
19. Draft an offer → check nothing has moved → send for approval → approve as COO → check it is still not issued → issue it → record acceptance → *Create employee*.


## Testing on your own, with volume

A demo database has a handful of rows in each module. That is enough to see a screen
work and not enough to find anything wrong with it. One command fills every feature
with 50 or more realistic records:

```
npm run seed:bulk
```

It layers on top of the demo data, takes about a second, and adds roughly:

| | |
|---|---|
| Customers, leads, quotes, activities | 70 jewellers · 106 deals · 55 quotes · 443 calls, visits and notes |
| Service desk | 262 tickets across six months, 24 still open, 9 past SLA, implementations on day plans |
| Development | 76 issues across every column, some blocked, sprints 40 onwards |
| Production and procurement | 74 work orders, 56 purchase items |
| Approvals | 54 leave · 54 expenses · 52 purchases · 50 discounts, most decided, some waiting |
| Tasks and man-hours | 60 assigned tasks · 250 time logs |
| SOPs | 83 runs over six weeks, worked at about 78% compliance with a tail of misses |
| Hiring | 10 roles at every approval stage · 72 candidates · 60 applications · ~50 interviews · ~80 scorecards, some part-submitted · 14 offers covering every state |
| KPIs | 13 weeks of history rebuilt from the data, so every sparkline and trend is real |

Everything is backdated across about six months, so SLA clocks, ageing buckets, trends
and the red-streak callout all have something behind them. Around a quarter of the rows
are deliberately awkward — breached, reopened, blocked, late, declined, withdrawn —
because that is where the bugs are.

Two things to know:

- **The test suite does not use this data.** `npm test` keeps its own small deterministic
  set, so bulk data can never make a test pass or fail by accident.
- **Point-in-time KPIs show a flat history.** Measures over a date range (bookings, SLA
  attainment, new leads) are computed correctly for each past week. The few that measure a
  state right now (open tickets, active headcount) repeat today's figure backwards, because
  the system cannot know what the count was in week 40. Their current value is right.

To start over at any point: delete the `data` folder, then `npm run seed:demo` followed by
`npm run seed:bulk`. To pile on a second batch, `npm run seed:bulk -- --force`.

## A test path for one person

Without a QA team, test in the order that finds the most for the least clicking. Each step
below is meant to break something, not to confirm it works.

**1. Look for a number you can disprove.** Open the Company page, pick any red tile, click
through to its detail, then read the "By person" table. Add up the people. Does it match the
company figure? If it does not, that is the most valuable bug you will find all week.

**2. Follow one ticket all the way.** Service desk → open a P1 → reply, escalate it to
Development, release the dev issue, confirm the ticket comes back on its own, resolve it,
then open the rating link. Six features, one path.

**3. Win a deal.** Pipeline → take a deal to Won. One transaction should produce a work
order, an invoice request and an implementation ticket. Check all three exist and point at
the right customer.

**4. Break an approval.** Request leave longer than your balance. Claim an expense over the
budget. Ask for a discount above your limit. Each should refuse, or route upward, and tell
you why.

**5. Run payroll against reality.** Build last month, approve it, open three payslips and
check the net against PagarGuru for the same three people.

**6. Be somebody else.** Sign in as Nikita (`nikita.kakade@loyalstring.com`) and try to open
`/company`, `/hire/candidates` and another person's payslip by typing the URL. All three must
refuse. This is the test that matters most before go-live.

**7. Use a phone.** Open the app on your phone on the office WiFi, check in, tick an SOP step,
open a ticket from the bottom tabs.

Write down what you find as you go. Anything that stops you from doing your job is a bug;
anything that merely annoys you is a change request, and those are cheaper after go-live.

## Adding tests
- Unit/integration tests use `tests/helpers.ts`: `testApp()` gives an in-memory app with master data; `startServer()` a real HTTP server; `Client` logs in and posts with CSRF handled.
- Prefer testing through the module functions for rules, and through HTTP for permissions and page rendering.
