import { html, when, type Raw } from '../../lib/html.ts';
import { page, modal, type View } from '../layout.ts';
import { icon, pill, empty, field, input, textarea, select, button, table, ring, bar } from '../components.ts';
import { sopChecklist } from './shared.ts';
import { stepsOf, type SopDefinition, type SopInstance } from '../../modules/sops/service.ts';
import type { Department, Employee } from '../../modules/people/model.ts';
import { fmtDate } from '../../lib/time.ts';

export interface SopsData {
  now: Date; tab: string; today: SopInstance[]; overdue: SopInstance[]; library: (SopDefinition & { c7: number | null; c30: number | null; stepCount: number })[];
  byPerson: { emp: Employee; done: number; total: number; pct: number | null }[]; canManage: boolean; overall7: number | null; filter: string;
}

export function sopsPage(v: View, d: SopsData): Raw {
  const tabs = [{ key: 'today', label: `Today (${d.today.length})` }, { key: 'overdue', label: `Overdue (${d.overdue.length})` }, { key: 'library', label: 'Library' }, ...(d.canManage ? [{ key: 'people', label: 'By person' }] : [])];
  const tone = d.overall7 === null ? 'neutral' : d.overall7 >= 90 ? 'good' : d.overall7 >= 80 ? 'warn' : 'crit';
  return page(v, {
    title: 'SOPs', subtitle: html`Standard operating procedures as daily checklists. Overdue steps escalate manager → HOD → COO.`,
    actions: html`<span class="row" style="gap:10px">${ring(d.overall7, { size: 44, stroke: 5, tone })}<span class="small muted">on time,<br>last 7 days</span></span>${when(d.canManage, button('New SOP', { href: '/sops/new', kind: 'primary', icon: 'plus' }))}`,
    body: html`<div class="tabs">${tabs.map((t) => html`<a href="/sops?tab=${t.key}" class="${d.tab === t.key ? 'active' : ''}">${t.label}</a>`)}</div>
      ${d.tab === 'today' ? (d.today.length ? html`<div class="grid grid-2" style="align-items:start">${d.today.map((i) => sopChecklist(i, { now: d.now, canEdit: i.assignee_id === v.user.id || d.canManage }))}</div>` : empty('No checklists due today in your scope.', '🌤️'))
      : d.tab === 'overdue' ? (d.overdue.length ? html`<div class="grid grid-2" style="align-items:start">${d.overdue.map((i) => sopChecklist(i, { now: d.now, canEdit: i.assignee_id === v.user.id || d.canManage }))}</div>` : empty('Nothing overdue. 🎉'))
      : d.tab === 'library' ? html`<section class="card">${table(['SOP', 'Department', 'Owner', 'Runs', 'Steps', 'On time 7 d', 'On time 30 d', ''], d.library.map((s) => [html`<b>${s.name}</b><br><span class="xs muted mono">${s.id} · v${s.version}</span>`, s.department_name || '—', s.owner_role.replace('_', ' '), html`${s.trigger}${when(s.trigger === 'weekly', () => html` (${['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][Number(s.trigger_detail) || 1]})`)}${when(s.trigger === 'monthly', () => html` (day ${s.trigger_detail || 1})`)}`, s.stepCount, pct(s.c7), pct(s.c30), html`<span class="row" style="gap:6px">${when(s.trigger === 'event' && d.canManage, button('Start', { post: `/sops/${s.id}/start`, size: 'sm', icon: 'bolt' }))}${when(d.canManage, button('Edit', { href: `/sops/${s.id}/edit`, size: 'sm', icon: 'edit' }))}</span>`]), { emptyText: 'No SOPs yet.' })}</section>`
      : html`<section class="card"><div class="card-head"><h2>On-time completion by person, last 30 days</h2></div>${table(['Person', 'Department', 'Steps on time', ''], d.byPerson.map((p) => [html`<a href="/people/${p.emp.id}">${p.emp.full_name}</a><br><span class="xs muted">${p.emp.designation}</span>`, p.emp.department_id, html`<b class="num">${p.done}/${p.total}</b> ${pct(p.pct)}`, bar(p.pct, p.pct === null ? 'neutral' : p.pct >= 90 ? 'good' : p.pct >= 80 ? 'warn' : 'crit')]), { emptyText: 'No SOP history in your scope.' })}</section>`}`
  });
}

function pct(n: number | null): Raw { return n === null ? pill('—', 'ink') : pill(`${n}%`, n >= 90 ? 'good' : n >= 80 ? 'warn' : 'crit'); }

export function sopEditorPage(v: View, o: { sop: SopDefinition | null; departments: Department[] }): Raw {
  const steps = o.sop ? stepsOf(o.sop) : [];
  const rows = Array.from({ length: Math.max(8, steps.length + 2) }, (_, i) => steps[i] || null);
  return page(v, { title: o.sop ? `Edit: ${o.sop.name}` : 'New SOP', subtitle: 'Each step can require evidence: a note, a call summary, a file name or a system record. Due offsets are business minutes from the shift start.', actions: button('Library', { href: '/sops?tab=library', kind: 'ghost' }),
    body: html`<form class="card form" method="post" action="${o.sop ? `/sops/${o.sop.id}` : '/sops'}" style="max-width:900px"><input type="hidden" name="_csrf" value="${v.csrf}">
      <div class="grid grid-2">${field('Name', input('name', { value: o.sop?.name || '', required: true }))}${field('Department', select('departmentId', o.departments.map((d) => ({ value: d.id, label: d.name, selected: d.id === (o.sop?.department_id || v.user.department_id) }))))}</div>
      <div class="grid grid-3">${field('Owner', select('ownerRole', [{ value: 'ic', label: 'A team member' }, { value: 'team_lead', label: 'Team lead' }, { value: 'hod', label: 'HOD' }].map((x) => ({ ...x, selected: x.value === (o.sop?.owner_role || 'team_lead') }))))}${field('Runs', select('trigger', [{ value: 'daily', label: 'Every working day' }, { value: 'weekly', label: 'Weekly' }, { value: 'monthly', label: 'Monthly' }, { value: 'event', label: 'On an event (started by hand)' }].map((x) => ({ ...x, selected: x.value === (o.sop?.trigger || 'daily') }))))}${field('Day (1 = Monday for weekly; day of month for monthly)', input('triggerDetail', { value: o.sop?.trigger_detail || '1' }))}</div>
      <h3>Steps</h3>
      <div class="table-wrap"><table><thead><tr><th>#</th><th>Step</th><th>Evidence</th><th>Due after (min)</th></tr></thead><tbody>${rows.map((s, i) => html`<tr><td>${i + 1}</td><td><input class="input" name="step_title[]" value="${s?.title || ''}" placeholder="${i === 0 ? 'First thing to do' : ''}"><input type="hidden" name="step_key[]" value="${s?.key || ''}"></td><td><select class="input" name="step_evidence[]">${['none', 'note', 'call', 'file', 'record'].map((e) => html`<option value="${e}" ${when((s?.evidence || 'none') === e, 'selected')}>${e}</option>`)}</select></td><td><input class="input" type="number" name="step_due[]" value="${s?.dueOffsetMin ?? 60 * (i + 1)}" min="0"></td></tr>`)}</tbody></table></div>
      <div class="row between"><span class="small muted">Blank rows are ignored. Saving creates a new version; today's open checklists keep the old one.</span><button class="btn btn-primary" type="submit">Save SOP</button></div></form>` });
}

export function sopRunPage(v: View, inst: SopInstance, now: Date): Raw {
  return page(v, { title: inst.sop_name || 'Checklist', subtitle: html`${fmtDate(inst.date)} · ${inst.assignee_name || 'Unassigned'} · ${inst.department_name || ''}`, actions: button('All SOPs', { href: '/sops', kind: 'ghost' }), body: html`<div style="max-width:720px">${sopChecklist(inst, { now, canEdit: inst.assignee_id === v.user.id || v.isManager })}</div>` });
}

export { modal, icon, textarea };
