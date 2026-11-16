// Settings → Lists: every drop-down, label and small number, by module, plus departments and sites.
import { html, when, type Raw } from '../../lib/html.ts';
import { page, type View } from '../layout.ts';
import { field, input, select, notice, pill, table, button } from '../components.ts';
import { MODULES, LIST_DEFS, NUMBER_DEFS, allItems, number, type ListDef } from '../../lib/lists.ts';
import { fmtDateTime } from '../../lib/time.ts';

export interface OrgData { departments: { id: string; name: string; code: string; hod_id: string | null; shift_code: string; band: string; people: number }[]; sites: { id: string; name: string; city: string; people: number }[]; employees: { id: string; full_name: string }[]; shifts: { code: string; name: string }[]; bands: { value: string; label: string }[] }
export interface ListsData { module: string; modules: string[]; org: OrgData | null; history: { at: string; actor: string; entity_id: string; action: string }[] }

const NEW_ROWS = 3;
const what = (id: string): string => id === 'numbers' ? 'Limits' : id.startsWith('org:') ? id.slice(4)[0].toUpperCase() + id.slice(5) : (LIST_DEFS.find((d) => 'list:' + d.key === id)?.title || id);

function listCard(def: ListDef): Raw {
  const rows = allItems(def.key); const open = def.mode === 'open';
  const cols = `minmax(0,2fr)${def.hindi ? ' minmax(0,2fr)' : ''}${def.number ? ' 120px' : ''}${open ? ' 110px' : ''}`;
  const head = html`<div class="xs muted" style="display:grid;grid-template-columns:${cols};gap:8px;margin-top:10px"><span>Name</span>${when(def.hindi, () => html`<span>Name in Hindi</span>`)}${when(def.number, () => html`<span>${def.number!.label}</span>`)}${when(open, () => html`<span>In use</span>`)}</div>`;
  const row = (i: number, r: { value: string; label: string; labelHi?: string; n?: number; active: boolean } | null, prefix: string): Raw => {
    const locked = !!r && (def.keep || []).includes(r.value);
    const numLocked = def.key === 'sales.stages' && !!r && (r.value === 'won' || r.value === 'lost');
    return html`<div style="display:grid;grid-template-columns:${cols};gap:8px;margin-top:6px;align-items:center">
      <input type="hidden" name="${prefix}value_${i}" value="${r?.value || ''}">
      <input class="input" name="${prefix}label_${i}" value="${r?.label || ''}" maxlength="60" placeholder="${r ? '' : 'Add a new entry'}" aria-label="Name">
      ${when(def.hindi, () => html`<input class="input" name="${prefix}labelHi_${i}" value="${r?.labelHi || ''}" maxlength="60" aria-label="Name in Hindi">`)}
      ${when(def.number, () => html`<input class="input" type="number" name="${prefix}n_${i}" value="${r?.n ?? ''}" min="${def.number!.min}" max="${def.number!.max}" ${when(numLocked, 'readonly')} aria-label="${def.number!.label}">`)}
      ${when(open, () => locked ? html`<span class="small muted">Always on<input type="hidden" name="${prefix}on_${i}" value="1"></span>` : html`<select class="input" name="${prefix}on_${i}" aria-label="In use"><option value="1" ${when(!r || r.active, 'selected')}>Yes</option><option value="0" ${when(r && !r.active, 'selected')}>No</option></select>`)}
    </div>`;
  };
  return html`<form class="card form" data-ajax action="/lists/save" id="${def.key.replace('.', '-')}" style="max-width:860px">
    <input type="hidden" name="key" value="${def.key}"><input type="hidden" name="count" value="${rows.length}">
    <div class="card-head"><h2>${def.title}</h2>${pill(open ? 'You can add entries' : 'Names only', 'ink')}</div>
    <p class="small muted" style="margin-top:4px">${def.help}</p>
    ${head}${rows.map((r, i) => row(i, r, ''))}
    ${when(open, () => html`${Array.from({ length: NEW_ROWS }, (_, i) => row(i, null, 'new_'))}
      <p class="xs muted" style="margin-top:8px">${def.stores === 'text' ? 'Old records keep the wording they were saved with.' : 'Renaming an entry also renames it on old records.'} To retire an entry, set "In use" to No; it stays on old records.</p>`)}
    <div class="row" style="justify-content:flex-end;gap:8px;margin-top:10px">${button('Reset', { post: '/lists/reset', body: { key: def.key }, confirm: 'Put this list back to how it came?', kind: 'ghost' })}<button class="btn btn-primary" type="submit">Save</button></div>
  </form>`;
}

function orgCards(o: OrgData): Raw {
  const hod = (name: string, value: string | null) => select(name, o.employees.map((e) => ({ value: e.id, label: e.full_name, selected: e.id === value })), { blank: 'Not set' });
  const shift = (name: string, value: string) => select(name, o.shifts.map((s) => ({ value: s.code, label: `${s.name} (${s.code})`, selected: s.code === value })));
  const band = (name: string, value: string) => select(name, o.bands.map((b) => ({ ...b, selected: b.value === value })));
  return html`<section class="card" style="max-width:1100px"><div class="card-head"><h2>Departments</h2><span class="small muted">${o.departments.length}</span></div>
      <p class="small muted" style="margin-top:4px">Rename a department, change its head, its shift or the company-dashboard group it reports under. A department cannot be deleted; move its people and stop using it.</p>
      ${o.departments.map((d) => html`<form class="form" data-ajax action="/lists/department" style="display:grid;grid-template-columns:minmax(0,2fr) 90px minmax(0,2fr) minmax(0,1.4fr) minmax(0,1.6fr) auto;gap:8px;margin-top:8px;align-items:center">
        <input type="hidden" name="id" value="${d.id}"><input class="input" name="name" value="${d.name}" maxlength="60" required aria-label="Name"><input class="input" name="code" value="${d.code}" readonly title="${d.people} people" aria-label="Code">
        ${hod('hodId', d.hod_id)}${shift('shiftCode', d.shift_code)}${band('band', d.band)}<button class="btn btn-sm" type="submit">Save</button></form>`)}
      <h3 style="margin-top:18px">Add a department</h3>
      <form class="form" data-ajax action="/lists/department" style="display:grid;grid-template-columns:minmax(0,2fr) 90px minmax(0,2fr) minmax(0,1.4fr) minmax(0,1.6fr) auto;gap:8px;margin-top:8px;align-items:center">
        <input class="input" name="name" maxlength="60" required placeholder="Name" aria-label="Name"><input class="input" name="code" maxlength="5" required placeholder="Code" aria-label="Code">${hod('hodId', null)}${shift('shiftCode', 'GEN')}${band('band', 'people')}<button class="btn btn-sm btn-primary" type="submit">Add</button></form>
      <p class="xs muted" style="margin-top:8px">A new department gets the company-wide screens. Its own KPI tiles still need to be defined by a developer.</p></section>
    <section class="card" style="max-width:860px"><div class="card-head"><h2>Sites</h2><span class="small muted">${o.sites.length}</span></div>
      ${o.sites.map((s) => html`<form class="form" data-ajax action="/lists/site" style="display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1.5fr) 90px auto;gap:8px;margin-top:8px;align-items:center">
        <input type="hidden" name="id" value="${s.id}"><input class="input" name="name" value="${s.name}" maxlength="60" required aria-label="Name"><input class="input" name="city" value="${s.city}" maxlength="40" placeholder="City" aria-label="City"><span class="small muted">${s.people} people</span><button class="btn btn-sm" type="submit">Save</button></form>`)}
      <h3 style="margin-top:18px">Add a site</h3>
      <form class="form" data-ajax action="/lists/site" style="display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1.5fr) 90px auto;gap:8px;margin-top:8px;align-items:center">
        <input class="input" name="name" maxlength="60" required placeholder="Name" aria-label="Name"><input class="input" name="city" maxlength="40" placeholder="City" aria-label="City"><input class="input" name="code" maxlength="5" required placeholder="Code" aria-label="Code"><button class="btn btn-sm btn-primary" type="submit">Add</button></form></section>`;
}

export function listsPage(v: View, d: ListsData): Raw {
  const defs = LIST_DEFS.filter((x) => x.module === d.module); const nums = NUMBER_DEFS.filter((x) => x.module === d.module);
  return page(v, {
    title: 'Lists and options', subtitle: 'The choices people see in each module. Change them here; no developer needed. Every change is recorded.',
    body: html`<div class="tabs">${d.modules.map((m) => html`<a href="/lists?module=${encodeURIComponent(m)}" class="${m === d.module ? 'active' : ''}">${m}</a>`)}</div>
      ${when(d.module === 'Organisation' && d.org, () => orgCards(d.org!))}
      ${defs.map(listCard)}
      ${when(nums.length, () => html`<form class="card form" data-ajax action="/lists/numbers" style="max-width:860px"><h2>Limits</h2>
        <div class="grid grid-2" style="margin-top:8px">${nums.map((n) => field(n.title, input(n.key, { type: 'number', value: number(n.key), min: n.min, max: n.max }), n.help))}</div>
        <div class="row" style="justify-content:flex-end"><button class="btn btn-primary" type="submit">Save</button></div></form>`)}
      ${when(!defs.length && !nums.length && d.module !== 'Organisation', () => notice('accent', 'Nothing to set for this module yet.'))}
      <section class="card" style="max-width:860px"><h2>Recent changes</h2>${table(['When', 'Who', 'What'], d.history.map((h) => [fmtDateTime(h.at), h.actor, `${what(h.entity_id)} · ${h.action === 'create' ? 'added' : h.action === 'reset' ? 'reset' : 'changed'}`]), { emptyText: 'No changes yet.' })}</section>`
  });
}
export { MODULES };
