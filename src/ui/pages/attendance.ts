import { html, when, type Raw } from '../../lib/html.ts';
import { page, modal, type View } from '../layout.ts';
import { icon, pill, empty, statCard, field, input, textarea, select, button, table, bar, avatar } from '../components.ts';
import type { DayRow, Regularisation, Holiday } from '../../modules/hr/attendance.ts';
import type { Employee } from '../../modules/people/model.ts';
import { fmtDate, fmtTime, fmtDuration } from '../../lib/time.ts';
import { monthName } from './payroll.ts';
import { attendanceTabs } from './attendance-extra.ts';
import { MISS_REASONS, type AttendanceRules } from '../../modules/hr/attendance-rules.ts';
import { notice } from '../components.ts';

export interface AttendanceData {
  month: string; months: string[]; employee: Employee; self: boolean; sheet: { rows: DayRow[]; present: number; leave: number; absent: number; late: number; workingDays: number };
  standing: { late: number; allowed: number; penalised: number; penalty: string; grace: number }; canManage: boolean; rules: AttendanceRules;
  regularisations: Regularisation[]; team: { employee: Employee; present: number; leave: number; absent: number; late: number }[]; canSeeTeam: boolean; people: Employee[];
}

export function attendancePage(v: View, d: AttendanceData): Raw {
  const s = d.sheet;
  return page(v, { title: 'Attendance', subtitle: html`${d.self ? 'Your' : d.employee.full_name + "'s"} ${monthName(d.month)} · ${s.present} present · ${s.leave} on leave · ${s.absent ? html`<b class="c-crit">${s.absent} absent</b>` : '0 absent'} of ${s.workingDays} working days`,
    actions: html`<form method="get" action="/attendance" class="row"><input type="hidden" name="employee" value="${d.employee.id}"><select class="input" name="month" data-autosubmit style="min-height:38px;width:auto">${d.months.map((m) => html`<option value="${m}" ${when(m === d.month, 'selected')}>${monthName(m)}</option>`)}</select></form>
      ${when(d.canSeeTeam, () => html`<form method="get" action="/attendance" class="row"><input type="hidden" name="month" value="${d.month}"><select class="input" name="employee" data-autosubmit style="min-height:38px;width:auto">${d.people.map((p) => html`<option value="${p.id}" ${when(p.id === d.employee.id, 'selected')}>${p.full_name}</option>`)}</select></form>`)}
      ${button('Miss-punch request', { modal: '/attendance/regularise', icon: 'edit' })}`,
    body: html`${attendanceTabs('sheet', d.canManage)}
      ${(() => { const st = d.standing; const left = st.allowed - st.late; return notice(st.penalised ? 'crit' : left <= 0 && st.late ? 'warn' : 'accent', html`<b>Late arrivals this month: ${st.late} of ${st.allowed} allowed.</b> On time means within ${st.grace} minutes of shift start. ${st.penalty === 'half_day' ? (st.penalised ? `${st.penalised} day${st.penalised > 1 ? 's have' : ' has'} been counted as a half day for being late beyond the allowance.` : left > 0 ? `${left} more ${left === 1 ? 'is' : 'are'} tolerated; after that each late arrival is a half day.` : 'The allowance is used up: the next late arrival is a half day.') : 'Late arrivals are recorded only.'}`); })()}
      <div class="grid grid-4">${statCard({ value: s.present, label: 'Present', tone: 'good', sub: `of ${s.workingDays} working days` })}${statCard({ value: s.leave, label: 'On approved leave', tone: 'accent' })}${statCard({ value: s.absent, label: 'Absent', tone: s.absent ? 'crit' : 'good', sub: 'no record and no leave' })}${statCard({ value: s.late, label: 'Late arrivals', tone: s.late > d.standing.allowed ? 'warn' : 'neutral', sub: `${d.standing.allowed} allowed a month` })}</div>
      <div class="cols"><section class="card col-main"><h2>${monthName(d.month)}</h2>
        <div class="table-wrap" style="margin-top:8px"><table><thead><tr><th>Date</th><th>In</th><th>Out</th><th>Hours</th><th>Status</th><th>Note</th></tr></thead><tbody>
          ${s.rows.map((r) => { const hours = r.checkIn && r.checkOut ? fmtDuration(Math.round((new Date(r.checkOut).getTime() - new Date(r.checkIn).getTime()) / 60000)) : ''; return html`<tr style="${!r.working ? 'opacity:.55' : r.status === 'absent' ? 'background:var(--crit-soft)' : ''}">
            <td>${fmtDate(r.date)} <span class="xs faint">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][(new Date(r.date + 'T06:00:00Z').getUTCDay() + 6) % 7]}</span></td>
            <td>${r.checkIn ? html`${fmtTime(r.checkIn)}${when(r.late, () => html` <span class="pill pill-warn">${r.late} min late</span>`)}` : '—'}</td>
            <td>${r.checkOut ? fmtTime(r.checkOut) : '—'}</td><td class="num">${hours}</td>
            <td>${r.status === 'present' ? pill(r.dayValue < 1 ? (r.penalty === 'late_over_allowance' ? 'Half day · late' : 'Half day') : 'Present', r.dayValue < 1 ? 'warn' : 'good') : r.status === 'leave' ? pill(`Leave (${r.onLeave})`, 'accent') : r.status === 'absent' ? pill('Absent', 'crit') : r.status ? html`<span class="small muted">${r.status}</span>` : ''}</td>
            <td><span class="small muted">${r.source === 'machine' ? 'Machine' : r.source === 'regularised' ? '' : r.checkIn ? 'In app' : ''}${r.note ? `${r.source === 'machine' ? ' · ' : ''}${r.note}` : ''}</span></td></tr>`; })}
        </tbody></table></div></section>
        <section class="card col-side"><h2>Miss-punch requests</h2><p class="small muted" style="margin:4px 0 10px">Missed a punch? Your team lead validates the request, then HR approves it.</p>
          ${table(['Date', 'Status'], d.regularisations.map((r) => [html`${fmtDate(r.date)}<br><span class="xs muted">${r.reason}${r.validator_note ? ` · Team lead: ${r.validator_note}` : ''}${r.hr_note ? ` · HR: ${r.hr_note}` : ''}</span>`, pill(r.status === 'pending' ? 'With team lead' : r.status === 'validated' ? 'With HR' : r.status === 'approved' ? 'Approved' : r.declined_stage === 'hr' ? 'Declined by HR' : 'Declined', r.status === 'approved' ? 'good' : r.status === 'declined' ? 'crit' : r.status === 'validated' ? 'accent' : 'warn')]), { emptyText: 'No requests.' })}
          ${when(d.canSeeTeam && d.team.length, () => html`<h3 style="margin-top:16px">Team this month</h3>${table(['Person', 'Present', 'Absent'], d.team.map((t) => [html`<a href="/attendance?employee=${t.employee.id}&month=${d.month}">${t.employee.full_name}</a>`, t.present, t.absent ? html`<b class="c-crit">${t.absent}</b>` : '0']))}`)}</section></div>` });
}

export function regulariseModal(v: View, windowDays = 7): Raw {
  const today = new Date().toISOString().slice(0, 10);
  const earliest = new Date(Date.now() - windowDays * 86_400_000).toISOString().slice(0, 10);
  return modal({ title: 'Miss-punch request', body: html`<form class="form" data-ajax action="/attendance/regularise">
    <div class="grid grid-2">${field('Date', input('date', { type: 'date', required: true, max: today, min: earliest }), `Within the last ${windowDays} days`)}
      ${field('Which punch was missed', select('kind', [{ value: 'in', label: 'Coming in' }, { value: 'out', label: 'Going out' }, { value: 'both', label: 'Both' }], {}))}</div>
    <div class="grid grid-2">${field('Time you came in', input('checkIn', { type: 'time' }), 'Needed if you missed the in punch')}${field('Time you left', input('checkOut', { type: 'time' }), 'Needed if you missed the out punch')}</div>
    ${field('Reason', select('reasonCode', MISS_REASONS, {}))}
    ${field('What happened', textarea('reason', { rows: 2, required: true, placeholder: 'A sentence your team lead and HR can check' }))}
    <div class="row between"><span class="small muted">Step 1: your team lead validates. Step 2: HR approves. Both write a comment.</span><button class="btn btn-primary" type="submit">Send request</button></div></form>` });
}

export function holidaysPage(v: View, o: { holidays: Holiday[]; year: string; years: string[] }): Raw {
  const rows = o.holidays.filter((h) => h.date.startsWith(o.year));
  const blank = Array.from({ length: Math.max(4, 18 - rows.length) }, () => ({ date: '', name: '' }));
  return page(v, { title: 'Holiday calendar', subtitle: 'Holidays stop SLA clocks, SOP checklists and payroll working days. Keep a year ahead of the business.',
    actions: html`<form method="get" action="/settings/holidays" class="row"><select class="input" name="year" data-autosubmit style="min-height:38px;width:auto">${o.years.map((y) => html`<option value="${y}" ${when(y === o.year, 'selected')}>${y}</option>`)}</select></form>${button('Settings', { href: '/settings?section=shifts', kind: 'ghost' })}`,
    body: html`<form class="card form" method="post" action="/settings/holidays" style="max-width:720px"><input type="hidden" name="_csrf" value="${v.csrf}"><input type="hidden" name="year" value="${o.year}">
      <p class="small muted">${rows.length} holiday${rows.length === 1 ? '' : 's'} in ${o.year}. Blank rows are ignored; clear a date to remove it.</p>
      <div class="table-wrap"><table><thead><tr><th style="width:200px">Date</th><th>Occasion</th></tr></thead><tbody>
        ${[...rows, ...blank].map((h) => html`<tr><td><input class="input" type="date" name="date[]" value="${h.date}"></td><td><input class="input" name="name[]" value="${h.name}" placeholder="Diwali, Republic Day, …"></td></tr>`)}
      </tbody></table></div>
      <div class="row between"><span class="small muted">Other years are kept as they are.</span><button class="btn btn-primary" type="submit">Save ${o.year} holidays</button></div></form>` });
}

export { icon, avatar, bar, empty, select };
