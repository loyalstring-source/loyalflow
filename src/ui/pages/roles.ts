// Settings → Roles and permissions.
import { html, when, type Raw } from '../../lib/html.ts';
import { page, type View } from '../layout.ts';
import { field, input, select, notice, pill, table, button, avatar, empty } from '../components.ts';
import { MODULE_DEFS, LEVELS, LEVEL_NAME, SCOPE_LABEL, rank, type Role, type RoleRow, type Level, type DataScope } from '../../lib/roles.ts';
import { fmtDateTime } from '../../lib/time.ts';

export interface PersonRow { id: string; full_name: string; designation: string; department: string; level: string; role_id: string | null; roleName: string; autoName: string; is_admin: number }
export interface RolesData {
  tab: 'roles' | 'people'; roles: RoleRow[];
  people: PersonRow[]; total: number; pageNo: number; pages: number; q: string; dept: string; departments: { id: string; name: string }[];
  history: { at: string; actor: string; entity: string; entity_id: string; action: string; who: string | null }[];
}

const tabs = (active: string): Raw => html`<div class="tabs"><a href="/roles" class="${active === 'roles' ? 'active' : ''}">Roles</a><a href="/roles?tab=people" class="${active === 'people' ? 'active' : ''}">Who has which role</a></div>`;
const href = (id: string): string => `/roles/edit?id=${encodeURIComponent(id)}`;
/** One line that says what a role is for: the modules it works in or manages. */
function summary(r: Role): string {
  const strong = MODULE_DEFS.filter((m) => rank(r.perms[m.key]) >= rank('work') && m.levels.none !== undefined || (r.perms[m.key] === 'manage' && m.levels.none === undefined)).map((m) => `${m.name}${r.perms[m.key] === 'manage' ? ' (manage)' : ''}`);
  return strong.length ? strong.join(' · ') : 'Own work only';
}

export function rolesPage(v: View, d: RolesData): Raw {
  const custom = d.roles.filter((r) => !r.auto), auto = d.roles.filter((r) => r.auto);
  const roleRow = (r: RoleRow): Raw => html`<a class="list-row" href="${href(r.id)}" style="text-decoration:none;color:inherit">
    <span style="flex:1;min-width:0"><b>${r.name}</b><br><span class="small muted">${summary(r)}</span></span>
    <span class="small muted" style="white-space:nowrap">Sees: ${r.scope === 'self' ? 'own records' : r.scope === 'team' ? 'own team' : 'everyone'}</span>
    ${pill(`${r.people} ${r.people === 1 ? 'person' : 'people'}`, r.people ? 'accent' : 'ink')}</a>`;
  const qs = (patch: Record<string, string | number>): string => { const p = new URLSearchParams({ tab: 'people', q: d.q, dept: d.dept, page: String(d.pageNo), ...Object.fromEntries(Object.entries(patch).map(([k, x]) => [k, String(x)])) }); return '/roles?' + p.toString(); };
  const roleOptions = (p: PersonRow) => [{ value: '', label: `Automatic — ${p.autoName}`, selected: !p.role_id }, ...custom.map((r) => ({ value: r.id, label: r.name, selected: p.role_id === r.id }))];
  return page(v, {
    title: 'Roles and permissions', subtitle: 'A role says what a person can do in each module and whose records they can open. Every change is recorded.',
    actions: d.tab === 'roles' ? button('New role', { href: '/roles/edit', kind: 'primary', icon: 'plus' }) : undefined,
    body: html`${tabs(d.tab)}
      ${d.tab === 'roles' ? html`
        ${notice('accent', html`<b>How it works.</b> Everyone starts on the automatic role for their department and level, which gives the access they have always had. Change an automatic role to change it for everyone at that level, or make your own role and give it to particular people. Administrators can always do everything.`)}
        <section class="card"><div class="card-head"><h2>Your own roles</h2><span class="small muted">${custom.length}</span></div>
          ${custom.length ? html`<div class="list">${custom.map(roleRow)}</div>` : empty('No roles of your own yet. Press New role to make one, for example "Accounts assistant" or "Regional sales lead".', '🗝️')}</section>
        <section class="card"><div class="card-head"><h2>Automatic roles</h2><span class="small muted">by department and level</span></div><div class="list">${auto.map(roleRow)}</div></section>
        <section class="card" style="max-width:860px"><h2>Recent changes</h2>${table(['When', 'Who', 'What'], d.history.map((h) => [fmtDateTime(h.at), h.actor, h.entity === 'employee' ? `${h.who || h.entity_id}: role changed` : `${d.roles.find((r) => r.id === h.entity_id)?.name || h.entity_id} · ${h.action === 'create' ? 'created' : h.action === 'delete' ? 'deleted' : h.action === 'reset' ? 'put back' : 'changed'}`]), { emptyText: 'No changes yet.' })}</section>`
      : html`
        <form class="card" method="get" action="/roles" style="display:flex;gap:10px;flex-wrap:wrap;align-items:center"><input type="hidden" name="tab" value="people">
          <input class="input" name="q" value="${d.q}" placeholder="Search by name" style="max-width:280px" aria-label="Search by name">
          <select class="input" name="dept" style="max-width:240px" aria-label="Department"><option value="">All departments</option>${d.departments.map((x) => html`<option value="${x.id}" ${when(x.id === d.dept, 'selected')}>${x.name}</option>`)}</select>
          <button class="btn" type="submit">Show</button><span class="small muted">${d.total} ${d.total === 1 ? 'person' : 'people'}</span></form>
        <section class="card">${d.people.length ? html`<div class="list">${d.people.map((p) => html`<div class="list-row" style="gap:12px;flex-wrap:wrap;align-items:center">
            <span class="row" style="gap:10px;flex:1;min-width:220px">${avatar(p.full_name, p.id)}<span><b>${p.full_name}</b>${when(p.is_admin, () => html` ${pill('Administrator', 'warn')}`)}<br><span class="small muted">${p.department} · ${p.level}</span></span></span>
            <form data-ajax action="/roles/assign" style="display:flex;gap:8px;flex:1;min-width:300px;align-items:center;flex-wrap:nowrap"><input type="hidden" name="employeeId" value="${p.id}"><span style="flex:1;min-width:0">${select('roleId', roleOptions(p), { id: 'role-' + p.id })}</span><button class="btn btn-sm" type="submit">Save</button></form>
            <a class="small" href="/roles/check?id=${encodeURIComponent(p.id)}" style="white-space:nowrap;align-self:center">What can they do?</a></div>`)}</div>` : empty('Nobody matches.', '🔎')}
          ${when(d.pages > 1, () => html`<div class="row between" style="margin-top:12px"><span class="small muted">Page ${d.pageNo} of ${d.pages}</span><span class="row" style="gap:8px">${when(d.pageNo > 1, () => html`<a class="btn btn-sm" href="${qs({ page: d.pageNo - 1 })}">Previous</a>`)}${when(d.pageNo < d.pages, () => html`<a class="btn btn-sm" href="${qs({ page: d.pageNo + 1 })}">Next</a>`)}</span></div>`)}</section>`}`
  });
}

export interface RoleEditData { role: Role | null; base: Role; people: { id: string; full_name: string; designation: string }[]; candidates: { id: string; full_name: string }[]; copies: { id: string; name: string }[]; copyOf: string; edited: boolean }

export function roleEditPage(v: View, d: RoleEditData): Raw {
  const r = d.role; const src = r || d.base; const isNew = !r;
  const groups = [...new Set(MODULE_DEFS.map((m) => m.group))];
  const levelSelect = (key: string, current: Level, levels: Partial<Record<Level, string>>): Raw =>
    html`<select class="input" name="p_${key}" aria-label="Access">${LEVELS.filter((l) => levels[l] !== undefined).map((l) => html`<option value="${l}" ${when(l === current, 'selected')}>${levels[l] === LEVEL_NAME[l] ? LEVEL_NAME[l] : `${LEVEL_NAME[l]} — ${levels[l]}`}</option>`)}</select>`;
  return page(v, {
    title: isNew ? 'New role' : r!.name, docTitle: isNew ? 'New role' : r!.name,
    subtitle: isNew ? 'Name it, choose what it can do, then give it to people.' : r!.auto ? 'Automatic role. A change here applies to everyone at this level in this department.' : 'Your own role. It applies to the people listed below.',
    actions: html`${button('All roles', { href: '/roles' })}`,
    body: html`
      ${when(isNew, () => html`<form class="card" method="get" action="/roles/edit" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;max-width:900px"><span class="small">Start from the access of</span>
        <select class="input" name="copy" style="max-width:340px" aria-label="Start from">${d.copies.map((c) => html`<option value="${c.id}" ${when(c.id === d.copyOf, 'selected')}>${c.name}</option>`)}</select><button class="btn btn-sm" type="submit">Use</button></form>`)}
      <form class="card form" data-ajax action="/roles/save" style="max-width:900px">
        <input type="hidden" name="id" value="${r?.id || ''}">
        <div class="grid grid-2">${field('Role name', input('name', { value: isNew ? '' : r!.name, required: true, placeholder: 'For example: Accounts assistant' }))}${field('Sees records of', select('scope', (Object.keys(SCOPE_LABEL) as DataScope[]).map((s) => ({ value: s, label: SCOPE_LABEL[s], selected: s === src.scope }))), 'People, attendance, tasks and reports at individual level.')}</div>
        ${field('What this role is for (optional)', input('description', { value: isNew ? '' : r!.description }))}
        ${groups.map((g) => html`<h3 style="margin-top:14px">${g}</h3>
          ${MODULE_DEFS.filter((m) => m.group === g).map((m) => html`<div style="display:grid;grid-template-columns:minmax(150px,220px) minmax(0,1fr);gap:12px;align-items:center;margin-top:8px"><label class="small" style="font-weight:600">${m.name}</label>${levelSelect(m.key, src.perms[m.key], m.levels)}</div>`)}`)}
        <div class="row" style="justify-content:flex-end;gap:8px;margin-top:16px">
          ${when(r && r.auto && d.edited, () => button('Put back to how it came', { post: '/roles/reset', body: { id: r!.id }, confirm: 'Put this role back to the access it started with?', kind: 'ghost' }))}
          ${when(r && !r.auto, () => button('Delete role', { post: '/roles/delete', body: { id: r!.id }, confirm: `Delete this role? ${d.people.length ? d.people.length + ' people go back to their automatic role.' : ''}`, kind: 'ghost' }))}
          ${when(r, () => button('Copy as a new role', { href: `/roles/edit?copy=${encodeURIComponent(r!.id)}` }))}
          <button class="btn btn-primary" type="submit">${isNew ? 'Create role' : 'Save'}</button></div>
      </form>
      ${when(r, () => html`<section class="card" style="max-width:900px"><div class="card-head"><h2>People in this role</h2><span class="small muted">${d.people.length}</span></div>
        ${d.people.length ? html`<div class="list">${d.people.map((p) => html`<div class="list-row"><span class="row" style="gap:10px;flex:1">${avatar(p.full_name, p.id)}<span><b>${p.full_name}</b><br><span class="small muted">${p.designation}</span></span></span>
          ${when(!r!.auto, () => button('Remove', { post: '/roles/assign', body: { employeeId: p.id, roleId: '' }, size: 'sm', confirm: `Put ${p.full_name} back on their automatic role?` }))}</div>`)}</div>` : empty('Nobody has this role yet.', '👤')}
        ${r!.auto ? html`<p class="small muted" style="margin-top:10px">People are here because of their department and level. To give one of them something different, make a role of your own and add them to it.</p>`
          : html`<form class="row" data-ajax action="/roles/assign" style="gap:8px;margin-top:12px;flex-wrap:wrap"><input type="hidden" name="roleId" value="${r!.id}">
            <select class="input" name="employeeId" style="max-width:380px" aria-label="Person" required><option value="">Choose a person to add</option>${d.candidates.map((c) => html`<option value="${c.id}">${c.full_name}</option>`)}</select><button class="btn btn-sm btn-primary" type="submit">Add to this role</button></form>`}</section>`)}`
  });
}

export function roleCheckPage(v: View, d: { person: { id: string; full_name: string; designation: string; is_admin: number }; role: Role; rows: { group: string; name: string; level: Level; meaning: string }[]; scope: DataScope; extras: string[] }): Raw {
  return page(v, {
    title: `What ${d.person.full_name} can do`, docTitle: d.person.full_name, subtitle: html`${d.person.designation} · role: <a href="${href(d.role.id)}">${d.role.name}</a>`,
    actions: button('Who has which role', { href: '/roles?tab=people' }),
    body: html`${when(d.person.is_admin, () => notice('warn', html`<b>Administrator.</b> Administrators can do everything, whatever their role says. This protects the company from being locked out.`))}
      ${when(d.extras.length, () => notice('accent', html`${d.extras.join(' ')}`))}
      <section class="card" style="max-width:900px"><p class="small muted">Can open the records of: <b class="c-ink">${SCOPE_LABEL[d.scope].toLowerCase()}</b>.</p>
        ${table(['Module', 'Access', 'What that means'], d.rows.map((x) => [html`<b>${x.name}</b><br><span class="xs muted">${x.group}</span>`, pill(LEVEL_NAME[x.level], x.level === 'none' ? 'ink' : x.level === 'manage' ? 'good' : 'accent'), x.meaning]))}</section>`
  });
}
