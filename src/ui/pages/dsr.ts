// Daily review (DSR): the sheet a team lead runs the morning plan and the evening review from.
import type { App } from '../../app.ts';
import { html, when, type Raw } from '../../lib/html.ts';
import { page, type View } from '../layout.ts';
import { button, notice, empty, icon, pill, avatar } from '../components.ts';
import { fmtDateTime, parseLocalDate } from '../../lib/time.ts';
import { STYLES, STATUS_LABEL, standing, refTarget, slotHours, ownLog, type Team, type DsrDay, type DsrItem, type Summary, type SupportPanels, type DsrStyle, type ItemStatus } from '../../modules/dsr/service.ts';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const dayName = (d: string): string => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d); if (!m) return d; const dt = parseLocalDate(d); return `${DAYS[new Date(dt.getTime() + 330 * 60000).getUTCDay()]} ${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`; };
const shortDay = (d: string): string => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d); return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}` : d; };
const inr = (n: number | null | undefined): string => (n == null ? '—' : '₹' + Math.round(n).toLocaleString('en-IN'));
const TONE: Record<ItemStatus, 'ink' | 'good' | 'warn' | 'crit'> = { planned: 'ink', done: 'good', partial: 'warn', not_done: 'crit', blocked: 'crit' };
const statusPill = (s: ItemStatus, label?: string): Raw => pill(label || STATUS_LABEL[s], TONE[s]);
const OPTIONS: ItemStatus[] = ['done', 'partial', 'not_done', 'blocked'];
const statusSelect = (name: string, current: string, blank: string): Raw => html`<select class="input dsr-in" name="${name}" aria-label="${blank}"><option value="">${blank}</option>${OPTIONS.map((o) => html`<option value="${o}" ${when(o === current, 'selected')}>${STATUS_LABEL[o]}</option>`)}</select>`;

export interface DsrPageData {
  teams: Team[]; team: Team; day: string; today: string; prev: string; next: string; record: DsrDay | undefined; items: DsrItem[]; summary: Summary;
  members: { id: string; full_name: string; designation: string }[]; refs: Map<string, { value: string; label: string }[]>; customers: string[]; support: SupportPanels | null; canConfigure: boolean; app: App; viewer: import('../../modules/people/model.ts').Employee;
}

function tiles(d: DsrPageData): Raw {
  const s = d.summary; const money = d.team.style === 'collections';
  const pctDone = s.lines ? Math.round((s.done / s.lines) * 100) : 0; const pctGot = s.expected ? Math.min(100, Math.round((s.collected / s.expected) * 100)) : 0;
  const tile = (label: string, value: string, meter?: number): Raw => html`<div class="kpi"><span class="kpi-label">${label}</span><b class="kpi-value num">${value}</b>${when(meter != null, () => html`<span class="meter" aria-hidden="true"><span style="width:${meter}%"></span></span>`)}</div>`;
  if (d.team.style === 'hourly') return html`<div class="kpis">${tile('Hours logged', s.logged.toLocaleString('en-IN', { maximumFractionDigits: 1 }))}${tile('People who logged', `${s.people} of ${d.members.length}`, d.members.length ? Math.round((s.people / d.members.length) * 100) : 0)}${tile('Entries', String(s.lines))}${tile('Accepted', `${s.lines - d.items.filter((i) => i.status === 'planned').length} of ${s.lines}`)}</div>`;
  return money
    ? html`<div class="kpis">${tile('Expected today', inr(s.expected))}${tile('Collected', inr(s.collected), pctGot)}${tile('Still to come', inr(Math.max(0, s.expected - s.collected)))}${tile('Customers', String(s.lines))}${tile('Brought forward', String(s.carriedIn))}</div>`
    : html`<div class="kpis">${tile('Planned', String(s.lines))}${tile('Done', `${s.done} of ${s.lines}`, pctDone)}${tile('Partly done', String(s.partial))}${tile('Not done or blocked', String(s.notDone + s.blocked))}${tile('Planned hours', s.hours.toLocaleString('en-IN', { maximumFractionDigits: 1 }))}</div>`;
}

function supportCards(p: SupportPanels): Raw {
  const line = (t: { id: string; subject: string; customer: string | null; assignee: string | null }, right: Raw): Raw => html`<a class="dsr-line" href="/tickets/${t.id}"><span class="dsr-line-main"><b>${t.subject}</b><span class="small muted">${t.id}${when(t.customer, () => html` · ${t.customer}`)} · ${t.assignee || 'Unassigned'}</span></span>${right}</a>`;
  const card = (title: string, count: number, body: Raw, none: string): Raw => html`<section class="card"><div class="card-head"><h2>${title}</h2><span class="small muted">${count}</span></div>${count ? html`<div class="dsr-lines">${body}</div>` : html`<p class="small muted" style="margin:0">${none}</p>`}</section>`;
  return html`<div class="dsr-panels">
    ${card(`New on ${shortDay(p.yesterday)}`, p.fresh.length, html`${p.fresh.map((t) => line(t, pill(t.priority, t.priority === 'P1' ? 'crit' : t.priority === 'P2' ? 'warn' : 'ink')))}`, 'No new tickets that day.')}
    ${card('Pending, oldest first', p.pendingTotal, html`${p.pending.map((t) => line(t, pill(`${t.days} day${t.days === 1 ? '' : 's'}`, t.days > 3 ? 'crit' : t.days > 1 ? 'warn' : 'ink')))}${when(p.pendingTotal > p.pending.length, () => html`<a class="small" href="/desk">See all ${p.pendingTotal} on the ticket board</a>`)}`, 'Nothing pending.')}
    ${card('Implementations under way', p.impl.length, html`${p.impl.map((t) => line(t, pill(`${(t.stage || 'setup').replace(/_/g, ' ')} · day ${t.days}${t.plan ? ` of ${t.plan}` : ''}`, t.plan && t.days > t.plan ? 'crit' : 'accent')))}`, 'No implementation in progress.')}
  </div>`;
}

function itemRow(d: DsrPageData, it: DsrItem, open: boolean, lead: boolean, me: string): Raw {
  const money = it.kind === 'collection'; const st = standing(it); const mine = it.employee_id === me; const target = refTarget(d.app, it.ref);
  const hourly = !!it.slot_from;
  const what = html`<td><div class="dsr-what">${when(hourly, () => html`<span class="dsr-slot num">${it.slot_from} to ${it.slot_to}</span>`)}${money ? html`<b>${it.customer}</b>${when(it.title, () => html`<span class="small muted">${it.title}</span>`)}` : html`<b>${it.title}</b>`}
    <span class="small muted">${when(target, () => html`<a href="${target!.href}">${it.ref}</a> `)}${when(it.carry_count, () => html`${pill(`Brought forward${it.carry_count > 1 ? ` ×${it.carry_count}` : ''}`, it.carry_count > 2 ? 'crit' : 'warn')} `)}${when(it.created_by === it.employee_id && !it.carried_from, () => html`added by self`)}</span></div></td>`;
  const plan = html`<td class="num" style="text-align:right;white-space:nowrap">${money ? inr(it.amount_expected) : it.planned_hours == null ? '—' : `${it.planned_hours} h`}</td>`;
  // The person's own update.
  const own = hourly ? html`<span class="small muted">${it.self_at ? `Logged ${fmtDateTime(it.self_at)}` : 'Added by the team lead'}</span>` : open && mine
    ? html`<span class="dsr-edit" data-url="/dsr/items/${it.id}/self">${money ? html`<input class="input dsr-in dsr-num" type="number" min="0" step="1" name="amount" value="${it.self_amount ?? ''}" placeholder="₹ received" aria-label="Amount received">` : html`${statusSelect('status', it.self_status, 'Your update')}<input class="input dsr-in dsr-pct" type="number" min="0" max="100" name="pct" value="${it.self_pct ?? ''}" placeholder="%" aria-label="Percent done">`}<input class="input dsr-in dsr-note" name="note" value="${it.self_note}" maxlength="500" placeholder="Note" aria-label="Note"><button class="btn btn-sm dsr-save" type="button">Save</button><span class="dsr-saved" aria-live="polite"></span></span>`
    : it.self_at ? html`${money ? html`<b>${inr(it.self_amount)}</b>` : it.self_status ? statusPill(it.self_status as ItemStatus, it.self_status === 'partial' && it.self_pct != null ? `Partly done ${it.self_pct}%` : undefined) : ''} <span class="small muted">${it.self_note}</span>` : html`<span class="small muted">No update yet</span>`;
  // The lead's review.
  const unfinished = ['partial', 'not_done', 'blocked'].includes(st.status);
  const review = open && lead && !ownLog(d.viewer, it)
    ? html`<span class="dsr-edit" data-url="/dsr/items/${it.id}/review">${money ? html`<input class="input dsr-in dsr-num" type="number" min="0" step="1" name="amount" value="${it.amount_actual ?? ''}" placeholder="₹ confirmed" aria-label="Amount confirmed">` : html`${statusSelect('status', it.status === 'planned' ? '' : it.status, 'Review')}<input class="input dsr-in dsr-pct" type="number" min="0" max="100" name="pct" value="${it.pct ?? ''}" placeholder="%" aria-label="Percent done">`}<input class="input dsr-in dsr-note" name="remark" value="${it.remark}" maxlength="500" placeholder="Remark" aria-label="Remark">${when(!hourly, () => html`<select class="input dsr-in" name="carry" aria-label="Tomorrow"><option value="carry" ${when(it.carry !== 'drop', 'selected')}>Carry if unfinished</option><option value="drop" ${when(it.carry === 'drop', 'selected')}>Drop</option></select>`)}<button class="btn btn-sm dsr-save" type="button">Save</button><span class="dsr-saved" aria-live="polite"></span></span>`
    : html`${it.status === 'planned' ? html`<span class="small muted">${open ? 'Waiting for review' : ''}</span>` : html`${statusPill(it.status, it.status === 'partial' && it.pct != null ? `Partly done ${it.pct}%` : money && it.status !== 'not_done' ? `${STATUS_LABEL[it.status]} ${inr(it.amount_actual)}` : undefined)}`} <span class="small muted">${it.remark}</span>
        ${when(!open && unfinished, () => html`<span class="small muted">${it.carried_to ? '· moved to the next day' : '· dropped'}</span>`)}`;
  const canDelete = open && (lead || (mine && it.created_by === me && it.status === 'planned'));
  return html`<tr>${what}${plan}<td>${own}</td><td>${review}</td><td style="text-align:right;padding-left:0">${when(canDelete, () => html`<button class="btn btn-ghost btn-sm" type="button" data-post="/dsr/items/${it.id}/delete" data-confirm="Remove this line?" title="Remove" aria-label="Remove">${icon('x', 14)}</button>`)}</td></tr>`;
}

function personCard(d: DsrPageData, m: { id: string; full_name: string; designation: string }, open: boolean, lead: boolean, me: string): Raw {
  const items = d.items.filter((i) => i.employee_id === m.id); const money = d.team.style === 'collections';
  const canAdd = open && (lead || m.id === me) && !(d.team.style === 'hourly' && d.day > d.today); if (!items.length && !canAdd) return html``;
  const done = items.filter((i) => standing(i).status === 'done').length; const refs = d.refs.get(m.id) || [];
  const hourly = d.team.style === 'hourly'; const loggedH = Math.round(items.reduce((a, i) => a + slotHours(i), 0) * 10) / 10; const lastTo = items.filter((i) => i.slot_to).map((i) => i.slot_to).sort().pop() || '09:30';
  const plus = (hm: string, mins: number): string => { const t = Math.min(23 * 60 + 59, Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3)) + mins); return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };
  const sub = hourly ? (items.length ? `${loggedH} h logged in ${items.length} entr${items.length === 1 ? 'y' : 'ies'}` : 'Nothing logged yet') : !items.length ? 'Nothing planned' : money ? `${inr(items.reduce((a, i) => a + (i.amount_expected || 0), 0))} expected · ${inr(items.reduce((a, i) => a + (standing(i).got || 0), 0))} collected` : `${done} of ${items.length} done`;
  return html`<section class="card dsr-person"><div class="card-head"><h2 style="gap:10px">${avatar(m.full_name, m.id)}<span>${m.full_name}<span class="small muted" style="display:block;font-weight:400">${m.designation}</span></span></h2><span class="small muted">${sub}</span></div>
    ${when(items.length, () => html`<div class="table-wrap"><table class="dsr-table"><thead><tr><th>${hourly ? 'Time and what was done' : money ? 'Customer' : 'Task'}</th><th style="text-align:right">${hourly ? 'Hours' : money ? 'Expected' : 'Planned'}</th><th>${hourly ? 'Logged' : money ? 'Received (own update)' : 'Own update'}</th><th>${hourly ? 'Accepted by lead' : money ? 'Confirmed by lead' : 'Review'}</th><th></th></tr></thead><tbody>${items.map((it) => itemRow(d, it, open, lead, me))}</tbody></table></div>`)}
    ${when(canAdd, () => html`<form class="dsr-add" data-ajax action="/dsr/items"><input type="hidden" name="team" value="${d.team.id}"><input type="hidden" name="day" value="${d.day}"><input type="hidden" name="employeeId" value="${m.id}">
      ${hourly ? html`<input class="input dsr-time" type="time" name="slotFrom" value="${lastTo}" required aria-label="From"><span class="small muted">to</span><input class="input dsr-time" type="time" name="slotTo" value="${plus(lastTo, 60)}" required aria-label="To"><input class="input" name="title" maxlength="300" required placeholder="What was done in this time" aria-label="What was done">` : money ? html`<input class="input" name="customer" list="dsr-customers" maxlength="160" required placeholder="Customer" aria-label="Customer"><input class="input dsr-num" type="number" name="amountExpected" min="1" step="1" required placeholder="₹ expected" aria-label="Amount expected"><input class="input" name="title" maxlength="300" placeholder="Note (invoice, mode of payment)" aria-label="Note">`
        : html`<input class="input" name="title" maxlength="300" placeholder="${refs.length ? (d.team.style === 'support' ? 'Follow-up, or pick a ticket' : 'Task, or pick a board item') : d.team.style === 'support' ? 'Follow-up' : 'Task'}" aria-label="Task">${when(refs.length, () => html`<select class="input dsr-ref" name="ref" aria-label="Board item or ticket"><option value="">${d.team.style === 'support' ? 'Ticket (optional)' : 'Board item (optional)'}</option>${refs.map((r) => html`<option value="${r.value}">${r.value} · ${r.label.slice(0, 70)}</option>`)}</select>`)}<input class="input dsr-num" type="number" name="plannedHours" min="0" max="24" step="0.5" placeholder="Hours" aria-label="Planned hours">`}
      <button class="btn" type="submit">${icon('plus', 14)} ${hourly ? 'Log' : 'Add'}</button></form>`)}
  </section>`;
}

export function dsrPage(v: View, d: DsrPageData): Raw {
  const closed = d.record?.status === 'closed'; const open = !closed; const lead = d.team.lead; const me = v.user.id; const isToday = d.day === d.today;
  const link = (day: string, team = d.team.id): string => `/dsr?team=${team}&day=${day}`;
  const waiting = d.items.filter((i) => i.status === 'planned').length; const selfDone = d.items.filter((i) => i.status === 'planned' && (i.kind === 'collection' ? i.self_amount != null : !!i.self_status)).length;
  const style = STYLES.find((s) => s.value === d.team.style)!;
  return page(v, {
    title: `Daily review · ${d.team.name}`, navTab: 'dsr',
    subtitle: html`${dayName(d.day)}${when(isToday, () => html` · today`)} · ${closed ? `closed by ${d.record!.closed_by_name || 'the team lead'} on ${fmtDateTime(d.record!.closed_at)}` : d.items.length ? `${d.items.length} line${d.items.length === 1 ? '' : 's'}, ${waiting} waiting for review` : 'nothing planned yet'}`,
    actions: html`${button('Previous', { href: link(d.prev) })}<form method="get" action="/dsr" class="dsr-day"><input type="hidden" name="team" value="${d.team.id}"><input class="input" type="date" name="day" value="${d.day}" aria-label="Day" data-autosubmit></form>${button('Next', { href: link(d.next) })}${when(!isToday, () => button('Today', { href: link(d.today) }))}
      ${when(lead && open && d.items.length && d.day <= d.today && !d.items.some((i) => ownLog(d.viewer, i)), () => button('Close the day', { post: '/dsr/close', body: { team: d.team.id, day: d.day }, kind: 'primary', confirm: `Close ${shortDay(d.day)} for ${d.team.name}? Lines not reviewed take the person's own update (or count as not done), and unfinished lines move to the next working day unless set to Drop.` }))}
      ${when(lead && closed, () => button('Reopen', { post: '/dsr/reopen', body: { team: d.team.id, day: d.day }, confirm: 'Reopen this day so it can be changed?' }))}`,
    body: html`
      ${when(d.teams.length > 1 || d.canConfigure, () => html`<div class="dsr-teams">${d.teams.map((t) => html`<a class="chip ${t.id === d.team.id ? 'on' : ''}" href="${link(d.day, t.id)}">${t.name}</a>`)}${when(d.canConfigure, () => html`<a class="small" href="/dsr/settings" style="margin-left:auto;align-self:center">Meeting style for each team</a>`)}</div>`)}
      ${closed ? notice('good', html`This day is closed and kept as the record.${when(d.record!.notes, () => html` Note: ${d.record!.notes}`)}`)
        : notice('accent', d.team.style === 'hourly' ? html`<b>${style.label}.</b> ${lead && !d.members.every((m) => m.id === me) ? 'Each person logs what they did against the time, through the day. Read the log in the evening, accept the entries, then close the day.' : 'Log what you did against the time you did it, as you go. Your manager reads and accepts it in the evening.'}${when(lead && selfDone && !d.items.some((i) => ownLog(d.viewer, i)), () => html` ${button(`Accept ${selfDone} entr${selfDone === 1 ? 'y' : 'ies'}`, { post: '/dsr/accept', body: { team: d.team.id, day: d.day }, size: 'sm' })}`)}` : lead ? html`<b>${style.label}.</b> Morning: add lines for each person. During the day they update their own lines. Evening: confirm each line, then close the day.${when(selfDone, () => html` ${button(`Confirm ${selfDone} from own updates`, { post: '/dsr/accept', body: { team: d.team.id, day: d.day }, size: 'sm' })}`)}`
          : html`<b>${style.label}.</b> Update your own lines through the day. Your team lead confirms them at the evening review.`)}
      ${when(d.items.length, () => tiles(d))}
      ${when(d.support, () => supportCards(d.support!))}
      ${d.members.length ? html`${d.members.map((m) => personCard(d, m, open, lead, me))}` : empty('This team has no active people.', '👥')}
      ${when(!d.items.length && closed, () => empty('Nothing was planned on this day.', '🗓️'))}
      ${when(d.customers.length, () => html`<datalist id="dsr-customers">${d.customers.map((c) => html`<option value="${c}"></option>`)}</datalist>`)}
      <script>(function () {
        var timers = new WeakMap();
        var dirty = false;
        function refreshWhenIdle() { var a = document.activeElement; if (dirty && !(a && a.closest && a.closest('.dsr-edit, .dsr-add'))) window.location.reload(); }
        function save(box) {
          var body = {}; box.querySelectorAll('[name]').forEach(function (el) { body[el.name] = el.value; });
          var mark = box.querySelector('.dsr-saved'); if (mark) mark.textContent = '…';
          window.LF.post(box.getAttribute('data-url'), body).then(function (res) {
            if (res && res.ok) { if (mark) mark.textContent = 'Saved'; dirty = true; setTimeout(refreshWhenIdle, 250); }
            else { if (mark) mark.textContent = ''; window.LF.toast({ kind: 'critical', title: 'Not saved', body: (res && res.error) || 'Try again.' }); }
          });
        }
        function sync(box) { var s = box.querySelector('select[name=status]'), p = box.querySelector('[name=pct]'); if (s && p) p.style.visibility = s.value === 'partial' ? 'visible' : 'hidden'; }
        document.querySelectorAll('.dsr-edit').forEach(sync);
        document.addEventListener('click', function (e) { var b = e.target.closest && e.target.closest('.dsr-save'); if (!b) return; var box = b.closest('.dsr-edit'); clearTimeout(timers.get(box)); b.blur(); save(box); });
        document.addEventListener('keydown', function (e) { if (e.key !== 'Enter') return; var box = e.target.closest && e.target.closest('.dsr-edit'); if (!box || e.target.tagName !== 'INPUT') return; e.preventDefault(); e.target.blur(); clearTimeout(timers.get(box)); save(box); });
        document.addEventListener('focusout', function () { setTimeout(refreshWhenIdle, 300); });
        document.addEventListener('change', function (e) { var box = e.target.closest && e.target.closest('.dsr-edit'); if (!box) return; sync(box); clearTimeout(timers.get(box)); timers.set(box, setTimeout(function () { save(box); }, 150)); });
      })();</script>`
  });
}

export function dsrEmptyPage(v: View, canConfigure: boolean): Raw {
  return page(v, { title: 'Daily review', navTab: 'dsr', subtitle: 'Your team does not hold a daily review in LoyalFlow.', actions: when(canConfigure, () => button('Meeting style for each team', { href: '/dsr/settings' })), body: empty('Ask an administrator to switch the daily review on for your team.', '🗓️') });
}

export function dsrSettingsPage(v: View, d: { styles: Record<string, DsrStyle>; teams: { id: string; name: string }[] }): Raw {
  return page(v, {
    title: 'Daily review · meeting style', navTab: 'dsr', subtitle: 'Each team runs its daily review its own way. Choose what each team plans in the morning and checks in the evening.', actions: button('Back to the daily review', { href: '/dsr' }),
    body: html`<form class="card form" data-ajax action="/dsr/settings" style="max-width:760px">
      <div class="table-wrap"><table><thead><tr><th>Team</th><th>Meeting style</th></tr></thead><tbody>${d.teams.map((t) => html`<tr><td><b>${t.name}</b></td><td><select class="input" name="${t.id}" aria-label="Meeting style for ${t.name}">${STYLES.map((s) => html`<option value="${s.value}" ${when(d.styles[t.id] === s.value, 'selected')}>${s.label}</option>`)}</select></td></tr>`)}</tbody></table></div>
      <ul class="small muted" style="margin:12px 0;padding-left:18px">${STYLES.map((s) => html`<li><b>${s.label}:</b> ${s.help}</li>`)}</ul>
      <div><button class="btn btn-primary" type="submit">Save</button></div></form>`
  });
}
