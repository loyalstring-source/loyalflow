// Monthly targets for the overview, who may set them, and who administers LoyalFlow.
import { html, when, type Raw } from '../../lib/html.ts';
import { page, type View } from '../layout.ts';
import { button, notice, avatar, pill, empty } from '../components.ts';
import { fmt, monthName, type Measure, type TargetInfo, type Setter, type AdminRow, type BriefSettings } from '../../modules/brief/service.ts';

export interface TargetRow { m: Measure; team: string; head: string | null; target: TargetInfo; last: number | null; editable: boolean }
export interface TargetsData {
  month: string; months: string[]; rows: TargetRow[]; canEdit: boolean; pastLocked: boolean; manage: boolean; setters: Setter[]; people: { id: string; full_name: string; designation: string }[]; teams: { id: string; name: string }[]; settings: BriefSettings;
}
const unitHint = (m: Measure): string => (m.unit === 'inr' ? 'rupees' : m.unit === 'pct' ? 'percent' : 'number');

export function targetsPage(v: View, d: TargetsData): Raw {
  const teams = [...new Set(d.rows.map((r) => r.team))];
  return page(v, {
    title: 'Targets', navTab: 'targets', subtitle: `What each team aims for in ${monthName(d.month, true)}. The overview measures every team against these.`,
    actions: html`<form method="get" action="/targets" class="row"><select class="input" name="month" data-autosubmit aria-label="Month" style="min-height:34px">${d.months.map((m) => html`<option value="${m}" ${when(m === d.month, 'selected')}>${monthName(m, true)}</option>`)}</select></form>${button('Open the overview', { href: '/overview' })}`,
    body: html`
      ${d.pastLocked ? notice('warn', 'This month has passed. Only an administrator or an executive can change its targets.') : notice('accent', html`A target you have not set for a month carries on from the month before, so set it once and change it only when it changes. Each team's manager sets that team's targets.`)}
      ${d.rows.length ? html`<form class="card" data-ajax action="/targets/save"><input type="hidden" name="month" value="${d.month}">
        <div class="table-wrap"><table><thead><tr><th>Team</th><th>Measure</th><th style="text-align:right">Achieved last month</th><th style="width:230px">Target for ${monthName(d.month)}</th><th>Set by</th></tr></thead><tbody>
        ${teams.map((t) => d.rows.filter((r) => r.team === t).map((r, i) => html`<tr><td>${i === 0 ? html`<b>${r.team}</b><br><span class="small muted">${r.head || 'No head set'}</span>` : ''}</td>
          <td><b>${r.m.name}</b><br><span class="small muted">${r.m.help}</span></td><td class="num" style="text-align:right">${fmt(r.m.unit, r.last)}</td>
          <td>${r.editable ? html`<div class="row" style="gap:8px;flex-wrap:nowrap"><input class="input" type="number" name="${r.m.key}" value="${r.target.value}" min="0" step="any" ${when(r.m.unit === 'pct', 'max="100"')} aria-label="Target for ${r.m.name}, in ${unitHint(r.m)}" style="max-width:150px"><span class="small muted">${r.m.unit === 'inr' ? fmt('inr', r.target.value) : r.m.unit === 'pct' ? '%' : ''}</span></div>` : html`<b class="num">${fmt(r.m.unit, r.target.value)}</b>`}</td>
          <td class="small muted">${r.target.source === 'set' ? `Set by ${r.target.setBy || 'someone'}` : r.target.source === 'carried' ? `Carried on from ${monthName(r.target.from!, true)}` : 'Starting figure, not set yet'}</td></tr>`))}
        </tbody></table></div>
        ${when(d.canEdit, () => html`<div style="margin-top:12px"><button class="btn btn-primary" type="submit">Save targets</button></div>`)}</form>` : empty('You do not set targets for any team.', '🎯')}

      ${when(d.manage, () => html`<section class="card"><div class="card-head"><h2>Who else can set targets</h2><span class="small muted">Team heads and team leads can always set their own team's targets</span></div>
        ${d.setters.length ? html`<ul class="list">${d.setters.map((s) => html`<li class="row" style="justify-content:space-between;gap:10px"><span class="row" style="gap:10px">${avatar(s.full_name, s.employee_id)}<span><b>${s.full_name}</b><br><span class="small muted">${s.designation}</span></span></span><span class="row" style="gap:10px">${pill(s.team, s.department_id === '*' ? 'warn' : 'accent')}${button('Remove', { post: '/targets/access/revoke', body: { employeeId: s.employee_id, team: s.department_id }, size: 'sm', confirm: `Stop ${s.full_name} setting targets for ${s.team}?` })}</span></li>`)}</ul>` : html`<p class="small muted" style="margin:0 0 10px">No one extra has been added yet.</p>`}
        <form class="row" data-ajax action="/targets/access/grant" style="gap:8px;margin-top:10px;align-items:flex-end"><label style="flex:2 1 240px"><span class="small muted">Person</span><select class="input" name="employeeId" required><option value="">Choose a person</option>${d.people.map((p) => html`<option value="${p.id}">${p.full_name} · ${p.designation}</option>`)}</select></label>
          <label style="flex:1 1 200px"><span class="small muted">Can set targets for</span><select class="input" name="team" required><option value="*">All teams</option>${d.teams.map((t) => html`<option value="${t.id}">${t.name}</option>`)}</select></label><button class="btn" type="submit">Add</button></form></section>

      <section class="card"><div class="card-head"><h2>How the overview is shown</h2></div>
        <form class="row" data-ajax action="/targets/display" style="gap:12px;align-items:flex-end"><label style="flex:0 1 240px"><span class="small muted">Seconds each view stays (today, week, month)</span><input class="input" type="number" name="seconds" min="15" max="600" step="5" value="${d.settings.seconds}" required></label>
          <label class="row" style="gap:8px;min-height:34px"><input type="checkbox" name="rotate" value="on" ${when(d.settings.rotate, 'checked')}> Change view by itself</label><button class="btn" type="submit">Save</button></form></section>`)}`
  });
}

export function adminsPage(v: View, d: { admins: AdminRow[]; people: { id: string; full_name: string; designation: string }[] }): Raw {
  return page(v, {
    title: 'Administrators', navTab: 'admins', subtitle: 'An administrator can do everything in LoyalFlow: settings, roles, targets, every team. Keep the list short.',
    body: html`
      ${notice('accent', html`Name one person to look after LoyalFlow day to day, so the executives do not have to. If you want a login that is not tied to a person, add it under People first (for example "LoyalFlow Admin"), then make it an administrator here.`)}
      <section class="card"><div class="card-head"><h2>Who can manage everything</h2></div>
        <ul class="list">${d.admins.map((a) => html`<li class="row" style="justify-content:space-between;gap:10px"><span class="row" style="gap:10px">${avatar(a.full_name, a.id)}<span><b>${a.full_name}</b><br><span class="small muted">${a.designation} · ${a.department}</span></span></span>
          <span class="row" style="gap:10px">${a.is_admin ? pill('Administrator', 'warn') : ''}${a.functional_role === 'executive' ? pill('Executive', 'accent') : ''}${when(a.is_admin, () => button('Remove', { post: '/admins/set', body: { employeeId: a.id, on: false }, size: 'sm', confirm: `Remove ${a.full_name} as an administrator?` }))}</span></li>`)}</ul>
        <form class="row" data-ajax action="/admins/set" style="gap:8px;margin-top:12px;align-items:flex-end"><input type="hidden" name="on" value="true"><label style="flex:1 1 300px"><span class="small muted">Make someone an administrator</span><select class="input" name="employeeId" required><option value="">Choose a person</option>${d.people.map((p) => html`<option value="${p.id}">${p.full_name} · ${p.designation}</option>`)}</select></label><button class="btn btn-primary" type="submit" data-confirm="This person will be able to change every setting and see every team. Continue?">Make administrator</button></form></section>
      <section class="card"><div class="card-head"><h2>What an administrator looks after</h2></div><ul class="small" style="margin:0;padding-left:18px;line-height:1.8">
        <li><a href="/targets">Targets</a>: monthly targets, and who else may set them</li><li><a href="/roles">Roles</a>: what each person can open and change</li><li><a href="/lists">Lists and options</a>: the choices in every form</li>
        <li><a href="/dsr/settings">Daily review style</a> for each team</li><li><a href="/settings">General settings</a>: company details, shifts, holidays, approvals</li><li><a href="/people">People</a>: adding people and resetting passwords</li></ul></section>`
  });
}
