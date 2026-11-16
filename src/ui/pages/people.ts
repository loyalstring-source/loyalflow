import { html, when, type Raw } from '../../lib/html.ts';
import { page, modal, type View } from '../layout.ts';
import { icon, pill, avatar, empty, field, input, select, button, table, tileCard, statCard, bar } from '../components.ts';
import type { Employee, Department, Site } from '../../modules/people/model.ts';
import type { Tile } from '../../modules/kpi/engine.ts';
import { fmtDate, fmtTime, fmtDateFull } from '../../lib/time.ts';

export interface PeopleData {
  employees: Employee[]; departments: Department[]; dept: string; q: string; tree: TreeNode | null; onLeave: { employee_id: string; full_name: string; type: string; to_date: string }[];
  headcount: number; present: number; canAdmin: boolean; byDept: { dept: Department; n: number }[]; month: string;
}
export interface TreeNode { e: Employee; children: TreeNode[] }

function node(n: TreeNode, depth: number): Raw {
  return html`<li><a class="node" href="/people/${n.e.id}">${avatar(n.e.full_name, n.e.id)}<span><b style="font-size:13px;display:block">${n.e.full_name}</b><span class="xs muted">${n.e.designation}${n.e.functional_role === 'executive' ? ' · Executive' : n.e.functional_role === 'hod' ? ' · HOD' : n.e.functional_role === 'team_lead' ? ' · Team lead' : ''}</span></span></a>${when(n.children.length && depth < 6, () => html`<ul>${n.children.map((c) => node(c, depth + 1))}</ul>`)}</li>`;
}

export function peoplePage(v: View, d: PeopleData): Raw {
  return page(v, {
    title: 'People', subtitle: html`${d.headcount} active · ${d.present} checked in today · ${d.onLeave.length} on leave`,
    actions: html`<form method="get" action="/people" class="row"><input type="hidden" name="dept" value="${d.dept}"><input class="input" name="q" value="${d.q}" placeholder="Search name or role" style="min-height:36px;width:200px"></form>${when(d.canAdmin, () => html`${button('Attendance Excel', { href: `/exports/attendance.xlsx?month=${d.month}`, icon: 'download', title: 'Attendance and approved leave for payroll' })}${button('People Excel', { href: '/exports/people.xlsx', icon: 'download' })}${button('Add employee', { modal: '/people/new', kind: 'primary', icon: 'plus' })}`)}`,
    body: html`
      <div class="checks"><a class="chip ${!d.dept ? 'on' : ''}" href="/people">All</a>${d.byDept.map((x) => html`<a class="chip ${d.dept === x.dept.id ? 'on' : ''}" href="/people?dept=${x.dept.id}">${x.dept.name} <span class="faint">${x.n}</span></a>`)}</div>
      ${when(d.onLeave.length, () => html`<div class="notice notice-accent">${icon('calendar')}<div><b>On leave today:</b> ${d.onLeave.map((l, i) => html`${when(i > 0, ', ')}<a href="/people/${l.employee_id}" style="color:inherit">${l.full_name}</a> (${l.type}, back ${fmtDate(new Date(new Date(l.to_date).getTime() + 86_400_000))})`)}</div></div>`)}
      <div class="cols">
        <section class="card col-main"><div class="card-head"><h2>Directory</h2><span class="small muted">${d.employees.length} people</span></div>
          ${table(['Name', 'Role', 'Department', 'Reports to', 'Shift', 'Status'], d.employees.map((e) => [html`<a href="/people/${e.id}" class="row" style="gap:8px;text-decoration:none;color:inherit;flex-wrap:nowrap">${avatar(e.full_name, e.id)}<span><b style="display:block">${e.full_name}</b><span class="xs muted">${e.email}</span></span></a>`, e.designation, d.departments.find((x) => x.id === e.department_id)?.name || e.department_id, d.employees.find((m) => m.id === e.reporting_manager_id)?.full_name || (e.reporting_manager_id || '—'), e.shift_code, e.status === 'active' ? pill('Active', 'good') : pill(e.status, 'ink')]), { emptyText: 'Nobody matches.' })}</section>
        ${when(d.tree && !d.dept && !d.q, () => html`<section class="card col-side orgtree" style="flex-basis:380px"><h2>Reporting lines</h2><ul style="padding-left:0;border:0;margin-top:10px">${node(d.tree!, 0)}</ul></section>`)}
      </div>`
  });
}

export interface ProfileData {
  e: Employee; manager: Employee | null; reports: Employee[]; dept: Department | null; site: Site | null; tiles: Tile[]; sop: { pct: number | null; done: number; total: number };
  attendance: { date: string; check_in: string | null; check_out: string | null }[]; leave: { type: string; from_date: string; to_date: string; days: number; status: string }[];
  canAdmin: boolean; inScope: boolean; self: boolean; openWork: { tickets: number; deals: number; orders: number; tasks: number };
}

export function profilePage(v: View, d: ProfileData): Raw {
  const e = d.e;
  return page(v, {
    title: e.full_name, docTitle: e.full_name, subtitle: html`${e.designation} · ${d.dept?.name || e.department_id}${when(e.sub_team, () => html` · ${e.sub_team}`)} · ${d.site?.name || ''}`,
    actions: html`${when(d.self, button('Change password', { href: '/change-password', icon: 'settings' }))}${when(d.canAdmin, () => html`${button('Edit', { modal: `/people/${e.id}/edit`, icon: 'edit' })}${button('Reset password', { post: `/people/${e.id}/reset-password`, confirm: `Email ${e.full_name} a password reset link and sign them out everywhere?`, icon: 'mail' })}`)}`,
    body: html`
      <div class="cols"><div class="col-main">
        <section class="card"><div class="grid grid-4">${statCard({ href: `/desk?q=${encodeURIComponent(e.full_name.split(' ')[0])}`, value: d.openWork.tickets, label: 'Open tickets', tone: 'accent' })}${statCard({ href: `/pipeline?owner=${e.id}`, value: d.openWork.deals, label: 'Open deals', tone: 'accent' })}${statCard({ value: d.openWork.orders, label: 'Work orders', tone: 'neutral' })}${statCard({ value: d.openWork.tasks, label: 'Open tasks', tone: d.openWork.tasks ? 'warn' : 'neutral' })}</div></section>
        ${when(d.tiles.length, () => html`<section class="card"><div class="card-head"><h2>KPIs this week</h2><span class="small muted">${d.inScope ? 'Visible to this person and their managers' : ''}</span></div><div class="grid grid-4" style="margin-top:12px">${d.tiles.map((t) => tileCard(t, `/kpi/${t.key}?scope=employee&id=${e.id}`))}</div></section>`)}
        ${when(d.inScope, () => html`<section class="card"><div class="card-head"><h2>SOP compliance, 30 days</h2><b class="num">${d.sop.pct === null ? '—' : `${d.sop.pct}%`}</b></div><div style="margin-top:10px">${bar(d.sop.pct, d.sop.pct === null ? 'neutral' : d.sop.pct >= 90 ? 'good' : d.sop.pct >= 80 ? 'warn' : 'crit')}</div><p class="small muted" style="margin-top:6px">${d.sop.done} of ${d.sop.total} due steps done on time.</p></section>`)}
        ${when(d.reports.length, () => html`<section class="card"><h2>Direct reports (${d.reports.length})</h2><ul class="list" style="margin-top:6px">${d.reports.map((r) => html`<li>${avatar(r.full_name, r.id)}<a href="/people/${r.id}" style="flex:1;text-decoration:none;color:inherit"><b style="font-size:13px">${r.full_name}</b><br><span class="xs muted">${r.designation}</span></a>${icon('arrow', 16, 'faint')}</li>`)}</ul></section>`)}
      </div><div class="col-side">
        <section class="card"><h2>Details</h2><ul class="list" style="margin-top:6px;font-size:13px">
          <li><span class="muted" style="width:110px">Employee id</span><b class="mono">${e.id}</b></li><li><span class="muted" style="width:110px">Email</span><span>${e.email}</span></li><li><span class="muted" style="width:110px">Mobile</span><span>${e.mobile || '—'}</span></li>
          <li><span class="muted" style="width:110px">Reports to</span><span>${d.manager ? html`<a href="/people/${d.manager.id}">${d.manager.full_name}</a>` : '—'}</span></li><li><span class="muted" style="width:110px">Role</span><span>${e.functional_role.replace('_', ' ')}${when(e.is_admin, ' · admin')}</span></li>
          <li><span class="muted" style="width:110px">Shift</span><span>${e.shift_code}</span></li><li><span class="muted" style="width:110px">Joined</span><span>${e.join_date ? fmtDateFull(e.join_date) : '—'}</span></li><li><span class="muted" style="width:110px">Status</span>${pill(e.status, e.status === 'active' ? 'good' : 'ink')}</li>
          ${when(e.pagarguru_code, () => html`<li><span class="muted" style="width:110px">PagarGuru code</span><span>${e.pagarguru_code}</span></li>`)}</ul></section>
        ${when(d.inScope, () => html`<section class="card"><h2>Attendance, last 10 days</h2>${table(['Date', 'In', 'Out'], d.attendance.map((a) => [fmtDate(a.date), fmtTime(a.check_in), a.check_out ? fmtTime(a.check_out) : '—']), { emptyText: 'No check-ins recorded.' })}</section>
          <section class="card"><h2>Leave</h2>${table(['Type', 'From', 'Days', 'Status'], d.leave.map((l) => [l.type, fmtDate(l.from_date), l.days, pill(l.status, l.status === 'approved' ? 'good' : l.status === 'declined' ? 'crit' : 'warn')]), { emptyText: 'No leave this year.' })}</section>`)}
      </div></div>`
  });
}

export function employeeModal(v: View, o: { e: Employee | null; departments: Department[]; managers: Employee[]; sites: Site[]; shifts: { code: string; name: string }[] }): Raw {
  const e = o.e;
  return modal({ title: e ? `Edit ${e.full_name}` : 'Add employee', body: html`<form class="form" data-ajax action="${e ? `/people/${e.id}` : '/people'}">
    <div class="grid grid-2">${field('Full name', input('full_name', { value: e?.full_name || '', required: true }))}${field('Work email', input('email', { type: 'email', value: e?.email || '', required: true }))}</div>
    <div class="grid grid-2">${field('Designation', input('designation', { value: e?.designation || '', required: true }))}${field('Department', select('department_id', o.departments.map((d) => ({ value: d.id, label: d.name, selected: d.id === e?.department_id }))))}</div>
    <div class="grid grid-3">${field('Reports to', select('reporting_manager_id', o.managers.filter((m) => m.id !== e?.id).map((m) => ({ value: m.id, label: m.full_name, selected: m.id === e?.reporting_manager_id })), { blank: 'Nobody (CEO)' }))}${field('Role', select('functional_role', [{ value: 'ic', label: 'Team member' }, { value: 'team_lead', label: 'Team lead' }, { value: 'hod', label: 'HOD' }, { value: 'executive', label: 'Executive' }].map((x) => ({ ...x, selected: x.value === (e?.functional_role || 'ic') }))))}${field('Shift', select('shift_code', o.shifts.map((s) => ({ value: s.code, label: `${s.code} · ${s.name}`, selected: s.code === e?.shift_code }))))}</div>
    <div class="grid grid-3">${field('Site', select('site_id', o.sites.map((s) => ({ value: s.id, label: s.name, selected: s.id === e?.site_id }))))}${field('Sub-team', input('sub_team', { value: e?.sub_team || '' }))}${field('Mobile', input('mobile', { value: e?.mobile || '' }))}</div>
    <div class="grid grid-3">${field('Join date', input('join_date', { type: 'date', value: e?.join_date || '' }))}${field('Status', select('status', [{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive (no sign-in)' }].map((x) => ({ ...x, selected: x.value === (e?.status || 'active') }))))}${field('Language', select('lang', [{ value: 'en', label: 'English' }, { value: 'hi', label: 'Hindi' }].map((x) => ({ ...x, selected: x.value === (e?.lang || 'en') }))))}</div>
    <div class="row between"><span class="small muted">${e ? 'Changes are audited.' : 'The new employee gets a welcome email with a password link.'}</span><button class="btn btn-primary" type="submit">${e ? 'Save' : 'Add employee'}</button></div></form>` });
}

export { empty };
