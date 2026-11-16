// Attendance: rules, the punching machine, and the miss-punch report.
import { html, raw, when, jsonScript, type Raw } from '../../lib/html.ts';
import { page, type View } from '../layout.ts';
import { pill, notice, field, input, select, button, table, statCard, empty } from '../components.ts';
import type { AttendanceRules, PunchDevice, MissPunchReport } from '../../modules/hr/attendance-rules.ts';
import { MISS_REASONS, reasonLabel } from '../../modules/hr/attendance-rules.ts';
import type { Employee } from '../../modules/people/model.ts';
import { fmtDate, fmtDateTime } from '../../lib/time.ts';

const tabs = (active: string, canManage: boolean): Raw => html`<div class="filters" style="margin-bottom:4px">
  <a class="chip ${active === 'sheet' ? 'on' : ''}" href="/attendance" style="display:inline-flex;align-items:center">Attendance</a>
  <a class="chip ${active === 'report' ? 'on' : ''}" href="/attendance/miss-punch" style="display:inline-flex;align-items:center">Miss-punch report</a>
  ${when(canManage, () => html`<a class="chip ${active === 'machine' ? 'on' : ''}" href="/attendance/machine" style="display:inline-flex;align-items:center">Punching machine</a>
  <a class="chip ${active === 'rules' ? 'on' : ''}" href="/attendance/rules" style="display:inline-flex;align-items:center">Rules</a>
  <a class="chip" href="/lists?module=Attendance%20and%20leave" style="display:inline-flex;align-items:center">Leave types and reasons</a>`)}</div>`;
export const attendanceTabs = tabs;

export function rulesPage(v: View, d: { rules: AttendanceRules; history: { at: string; actor: string; before: string; after: string }[]; halfDayAfter: number }): Raw {
  const r = d.rules;
  const changes = (b: string, a: string): string => { try { const x = JSON.parse(b || '{}') as Record<string, unknown>, y = JSON.parse(a || '{}') as Record<string, unknown>; return Object.keys(y).filter((k) => x[k] !== y[k]).map((k) => `${k}: ${String(x[k] ?? '—')} → ${String(y[k])}`).join(' · ') || 'No change'; } catch { return ''; } };
  return page(v, {
    title: 'Attendance rules', subtitle: 'Set by HR or an executive. A change applies to the current month straight away; months already closed keep what they were paid on.',
    body: html`${tabs('rules', true)}
      <div class="cols"><div class="col-main stack">
        <section class="card"><h2>Late arrivals</h2>
          <form data-post="/attendance/rules" class="stack" style="margin-top:10px">
            <div class="grid grid-3">
              ${field('On time up to (minutes after shift start)', input('lateGraceMinutes', { type: 'number', min: 0, max: 120, value: r.lateGraceMinutes }))}
              ${field('Late arrivals allowed in a month', input('lateAllowedPerMonth', { type: 'number', min: 0, max: 31, value: r.lateAllowedPerMonth }))}
              ${field('After that, a late arrival is', select('latePenalty', [{ value: 'half_day', label: 'A half day', selected: r.latePenalty === 'half_day' }, { value: 'none', label: 'Only recorded', selected: r.latePenalty === 'none' }], {}))}
            </div>
            ${notice('accent', `As set now: arriving up to ${r.lateGraceMinutes} minutes after shift start is on time. Later than that is a late arrival. The first ${r.lateAllowedPerMonth} in a calendar month are tolerated; ${r.latePenalty === 'half_day' ? `from number ${r.lateAllowedPerMonth + 1}, each late arrival makes that day a half day` : 'more than that is recorded but costs nothing'}. Separately, arriving more than ${Math.round(d.halfDayAfter / 60 * 10) / 10} hours late is always a half day (Payroll settings).`)}
            <h2 style="margin-top:6px">Miss-punch requests</h2>
            <div class="grid grid-3">
              ${field('Can be raised for the last (days)', input('missPunchWindowDays', { type: 'number', min: 1, max: 90, value: r.missPunchWindowDays }))}
              ${field('Flag a person at (requests in a month)', input('missPunchFlagPerMonth', { type: 'number', min: 0, max: 31, value: r.missPunchFlagPerMonth }), '0 switches the flag off. There is no cap on requests.')}
              ${field('Machine punches', select('machineIsSource', [{ value: '1', label: 'Set in and out from the machine', selected: r.machineIsSource }, { value: '0', label: 'Only store them', selected: !r.machineIsSource }], {}))}
            </div>
            <div class="row right">${button('Save rules', { type: 'submit', kind: 'primary' })}</div>
          </form>
        </section>
      </div>
      <aside class="col-side stack"><section class="card"><h2>Changes</h2>
        ${d.history.length ? html`<div class="list" style="margin-top:6px">${d.history.map((h) => html`<div class="list-row"><span><b class="small">${h.actor}</b><br><span class="xs muted">${fmtDateTime(h.at)}<br>${changes(h.before, h.after)}</span></span></div>`)}</div>` : html`<p class="small muted" style="margin-top:6px">The rules have not been changed yet. These are the starting values.</p>`}
      </section></aside></div>` });
}

export function machinePage(v: View, d: { devices: PunchDevice[]; unmatched: { pin: string; punches: number; first: string; last: string }[]; people: (Employee & { device_pin?: string })[]; recent: { local_date: string; local_time: string; pin: string; device_sn: string; source: string; employee_name: string | null }[]; serverUrl: string; local: boolean }): Raw {
  const waiting = d.devices.filter((x) => !x.active && !x.name);
  const mapped = d.people.filter((p) => p.device_pin).length;
  const peopleOptions = [{ value: '', label: 'Choose the employee' }, ...d.people.filter((p) => !p.device_pin).map((p) => ({ value: p.id, label: `${p.full_name} · ${p.id}` }))];
  return page(v, {
    title: 'Punching machine', subtitle: `${d.devices.filter((x) => x.active).length} machine${d.devices.filter((x) => x.active).length === 1 ? '' : 's'} connected · ${mapped} of ${d.people.length} people have a machine ID`,
    body: html`${tabs('machine', true)}
      ${when(waiting.length, () => notice('warn', html`<b>${waiting.length} machine${waiting.length > 1 ? 's' : ''} tried to connect and ${waiting.length > 1 ? 'are' : 'is'} waiting for you.</b> Check the serial number against the machine, then approve it below. Until then nothing it sends is accepted.`))}
      <div class="cols"><div class="col-main stack">
        <section class="card"><div class="card-head"><h2>Machines</h2></div>
          ${d.devices.length ? table(['Serial number', 'Name', 'Status', 'Last heard from', 'Punches', ''], d.devices.map((x) => [
            html`<b>${x.sn}</b>`, html`${x.name || html`<span class="muted">—</span>`}`, x.active ? pill('Connected', 'good') : x.name ? pill('Switched off', 'ink') : pill('Waiting for approval', 'warn'),
            html`<span class="small">${x.last_seen_at ? fmtDateTime(x.last_seen_at) : 'Never'}${x.last_ip ? html`<br><span class="xs muted">${x.last_ip}</span>` : ''}</span>`, html`${x.punches || 0}`,
            x.active ? button('Switch off', { post: '/attendance/machine/device', body: { sn: x.sn, active: '0', name: x.name || x.sn }, size: 'sm', kind: 'ghost', confirm: `Stop accepting punches from ${x.sn}?` }) : button('Approve', { post: '/attendance/machine/device', body: { sn: x.sn, active: '1' }, size: 'sm', kind: 'primary', prompt: 'A name for this machine (for example: Main gate)', promptKey: 'name' })
          ])) : empty('No machine yet. Add its serial number below, or point the machine at this server and approve it when it appears here.')}
          <form data-post="/attendance/machine/device" class="row" style="gap:10px;align-items:flex-end;margin-top:14px;flex-wrap:wrap">
            <span style="flex:1 1 200px">${field('Serial number', input('sn', { placeholder: 'Printed on the machine, also under System Info', required: true }))}</span>
            <span style="flex:1 1 200px">${field('Name', input('name', { placeholder: 'Main gate' }))}</span>
            <input type="hidden" name="active" value="1"><span>${button('Add machine', { type: 'submit' })}</span>
          </form>
        </section>
        <section class="card"><h2>Connect a ZKTeco machine</h2>
          <ol style="margin:10px 0 0;padding-left:20px;line-height:1.9" class="small">
            <li>On the machine: Menu → Comm. → Cloud Server Setting (some models call it ADMS).</li>
            <li>Server address: <b>${d.serverUrl.replace(/^https?:\/\//, '').replace(/:\d+$/, '')}</b> · Port: <b>${(d.serverUrl.match(/:(\d+)$/) || [])[1] || (d.serverUrl.startsWith('https') ? '443' : '80')}</b> · Enable Domain Name: on if the address is a name, off if it is numbers · HTTPS: ${d.serverUrl.startsWith('https') ? 'on' : 'off'}.</li>
            <li>Save. Within a minute the machine appears in the list above as “Waiting for approval”. Approve it.</li>
            <li>Give each person their machine user ID below. Punches then arrive by themselves, a few seconds after each punch.</li>
          </ol>
          ${when(d.local, () => notice('warn', 'This copy of LoyalFlow runs on this computer only, so a machine in the office cannot reach it over the internet yet. Until the app is hosted, use “Upload a punch file” below, or put this computer and the machine on the same office network and type this computer’s network address into the machine.'))}
          <p class="xs muted" style="margin-top:8px">Written to ZKTeco’s published push protocol. It has not been tried with your machine yet; the first connection is the test.</p>
        </section>
        <section class="card"><h2>Upload a punch file</h2>
          <p class="small muted" style="margin:6px 0 10px">The file exported from the machine to a USB stick (attlog.dat) or from its software as CSV or text. Each line needs a user ID, a date and a time. Uploading the same file twice adds nothing twice.</p>
          <input class="input" type="file" id="punch-file" accept=".dat,.csv,.txt,.log" style="padding:8px"><p class="small muted" id="punch-state" style="margin-top:8px" aria-live="polite"></p>
          <script id="punch-config" type="application/json">${jsonScript({ url: '/attendance/machine/file' })}</script>
          ${raw(`<script>
(function () {
  var cfg = JSON.parse(document.getElementById('punch-config').textContent), el = document.getElementById('punch-file'), st = document.getElementById('punch-state');
  el.addEventListener('change', function () {
    var f = el.files && el.files[0]; if (!f) return;
    if (f.size > 4 * 1024 * 1024) { window.LF.toast({ title: 'That did not work', body: 'The file is larger than 4 MB. Export a shorter period.', kind: 'error' }); el.value = ''; return; }
    st.textContent = 'Reading ' + f.name + '…'; el.disabled = true;
    f.text().then(function (text) { return window.LF.post(cfg.url, { name: f.name, text: text }); }).then(function (res) {
      el.disabled = false; el.value = '';
      if (res && res.ok) { st.textContent = res.summary; window.LF.toast({ title: 'Punch file read', body: res.summary, kind: 'success' }); setTimeout(function () { location.reload(); }, 1600); }
      else { st.textContent = ''; window.LF.toast({ title: 'That did not work', body: (res && res.error) || 'The file could not be read.', kind: 'error' }); }
    });
  });
})();
</script>`)}
        </section>
        <section class="card"><h2>Latest punches</h2>
          ${d.recent.length ? table(['Date', 'Time', 'Machine ID', 'Person', 'From'], d.recent.map((p) => [fmtDate(p.local_date), p.local_time.slice(0, 5), html`<b>${p.pin}</b>`, p.employee_name ? html`${p.employee_name}` : pill('No person yet', 'warn'), html`<span class="small muted">${p.source === 'file' ? 'File' : p.device_sn}</span>`])) : empty('No punches received yet.')}
        </section>
      </div>
      <aside class="col-side stack">
        <section class="card"><h2>Machine IDs without a person</h2>
          ${d.unmatched.length ? html`<p class="small muted" style="margin:6px 0 10px">These IDs have punched, but nobody in LoyalFlow has that ID. Pick the person and their past punches are attached.</p>
            <div class="stack">${d.unmatched.slice(0, 30).map((u) => html`<form data-post="/attendance/machine/pin" class="row" style="gap:8px;align-items:flex-end">
              <input type="hidden" name="pin" value="${u.pin}"><span style="flex:0 0 74px"><b>ID ${u.pin}</b><br><span class="xs muted">${u.punches} punches</span></span>
              <span style="flex:1;min-width:0">${select('employeeId', peopleOptions, {})}</span>${button('Link', { type: 'submit', size: 'sm' })}</form>`)}</div>` : html`<p class="small muted" style="margin-top:6px">Every ID that has punched belongs to somebody.</p>`}
        </section>
        <section class="card"><h2>Everyone’s machine ID</h2>
          <div style="max-height:520px;overflow:auto;margin-top:8px">${d.people.map((p) => html`<form data-post="/attendance/machine/pin" class="row" style="gap:8px;align-items:center;padding:6px 0;border-top:1px solid var(--line2)">
            <input type="hidden" name="employeeId" value="${p.id}"><span class="small" style="flex:1;min-width:0">${p.full_name}<br><span class="xs muted">${p.id}</span></span>
            <input class="input" name="pin" value="${p.device_pin || ''}" placeholder="ID" style="width:74px;min-height:36px" aria-label="Machine ID for ${p.full_name}">${button('Save', { type: 'submit', size: 'sm', kind: 'ghost' })}</form>`)}</div>
        </section>
      </aside></div>` });
}

export function missPunchReportPage(v: View, d: { report: MissPunchReport; from: string; to: string; departments: { id: string; name: string }[]; departmentId: string; employeeId: string; people: Employee[]; canManage: boolean; scopeNote: string }): Raw {
  const r = d.report; const t = r.totals;
  const qs = `from=${d.from}&to=${d.to}${d.departmentId ? `&department=${d.departmentId}` : ''}${d.employeeId ? `&employee=${d.employeeId}` : ''}`;
  const status = (s: string, stage: string): Raw => s === 'approved' ? pill('Approved', 'good') : s === 'declined' ? pill(stage === 'hr' ? 'Declined by HR' : 'Declined by team lead', 'crit') : s === 'validated' ? pill('With HR', 'accent') : pill('With team lead', 'warn');
  return page(v, {
    title: 'Miss-punch report', subtitle: `${fmtDate(d.from)} to ${fmtDate(d.to)} · ${d.scopeNote}`,
    actions: html`<a class="btn" href="/attendance/miss-punch.csv?${qs}">Download for Excel</a>`,
    body: html`${tabs('report', d.canManage)}
      <form method="get" action="/attendance/miss-punch" class="row" style="gap:10px;align-items:flex-end;flex-wrap:wrap">
        <span>${field('From', input('from', { type: 'date', value: d.from }))}</span><span>${field('To', input('to', { type: 'date', value: d.to }))}</span>
        ${when(d.departments.length > 1, () => html`<span>${field('Team', select('department', [{ value: '', label: 'All teams' }, ...d.departments.map((x) => ({ value: x.id, label: x.name, selected: x.id === d.departmentId }))], {}))}</span>`)}
        ${when(d.people.length > 1, () => html`<span>${field('Person', select('employee', [{ value: '', label: 'Everyone' }, ...d.people.map((p) => ({ value: p.id, label: p.full_name, selected: p.id === d.employeeId }))], {}))}</span>`)}
        <span style="padding-bottom:2px"><button class="btn" type="submit">Show</button></span>
      </form>
      <div class="grid grid-4">
        ${statCard({ value: t.requested, label: 'Requests', sub: `${r.byPerson.length} people` })}
        ${statCard({ value: t.approved, label: 'Approved', tone: 'good' })}
        ${statCard({ value: t.declined, label: 'Declined', tone: t.declined ? 'crit' : 'neutral' })}
        ${statCard({ value: r.byPerson.filter((p) => p.flagged).length, label: 'People flagged', tone: r.byPerson.some((p) => p.flagged) ? 'warn' : 'neutral', sub: r.flagLevel ? `${r.flagLevel} or more in one month` : 'Flag is switched off' })}
      </div>
      <div class="cols"><div class="col-main stack">
        <section class="card"><h2>By person</h2>
          ${r.byPerson.length ? table(['Person', 'Team', 'Requests', 'Approved', 'Declined', 'Waiting', 'Most in one month', 'Usual reason'], r.byPerson.map((p) => [
            html`<a href="/attendance/miss-punch?from=${d.from}&to=${d.to}&employee=${p.employee_id}"><b>${p.name}</b></a>${when(p.flagged, () => html` ${pill('Flagged', 'warn')}`)}`, html`<span class="small muted">${p.department}</span>`,
            html`<b>${p.requested}</b>`, html`${p.approved}`, html`${p.declined}`, html`${p.waiting}`, html`${p.worstMonth}`, html`<span class="small">${p.topReason}</span>`])) : empty('No miss-punch requests in this period.')}
        </section>
        <section class="card"><h2>Every request</h2>
          ${r.rows.length ? table(['Date', 'Person', 'Missed', 'Reason', 'Team lead', 'HR', 'Result'], r.rows.slice(0, 300).map((x) => [
            html`${fmtDate(x.date)}<br><span class="xs muted">asked ${fmtDate(x.created_at)}</span>`, html`<b>${x.employee_name}</b><br><span class="xs muted">${x.department}</span>`,
            html`<span class="small">${x.kind === 'in' ? `In ${x.requested_in || ''}` : x.kind === 'out' ? `Out ${x.requested_out || ''}` : `In ${x.requested_in || ''}, out ${x.requested_out || ''}`}</span>`,
            html`<span class="small"><b>${reasonLabel(x.reason_code)}</b><br><span class="muted">${x.reason}</span></span>`,
            html`<span class="small">${x.validated_by_name ? html`${x.validated_by_name}<br><span class="xs muted">${x.validated_at ? fmtDate(x.validated_at) : ''} · ${x.validator_note}</span>` : html`<span class="muted">—</span>`}</span>`,
            html`<span class="small">${x.decided_by_name && (x.status === 'approved' || x.declined_stage === 'hr') ? html`${x.decided_by_name}<br><span class="xs muted">${x.decided_at ? fmtDate(x.decided_at) : ''} · ${x.hr_note}</span>` : html`<span class="muted">—</span>`}</span>`,
            status(x.status, x.declined_stage)])) : empty('Nothing to show.')}
          ${when(r.rows.length > 300, () => html`<p class="xs muted" style="margin-top:8px">Showing the latest 300 of ${r.rows.length}. The download has all of them.</p>`)}
        </section>
      </div>
      <aside class="col-side stack">
        <section class="card"><h2>Reasons given</h2>${r.byReason.length ? table(['Reason', 'Count'], r.byReason.map((x) => [html`<span class="small">${x.reason}</span>`, html`<b>${x.count}</b>`])) : html`<p class="small muted" style="margin-top:6px">None.</p>`}</section>
        <section class="card"><h2>Who decided</h2>${r.byApprover.length ? table(['Name', 'Decided', 'Approved'], r.byApprover.map((x) => [html`<span class="small">${x.name}<br><span class="xs muted">${x.role}</span></span>`, html`${x.decided}`, html`${x.approved}${when(x.decided >= 5 && x.approved === x.decided, () => html` ${pill('All approved', 'warn')}`)}`])) : html`<p class="small muted" style="margin-top:6px">No decisions yet.</p>`}
          <p class="xs muted" style="margin-top:8px">“All approved” marks someone who has decided five or more requests and never declined one.</p></section>
      </aside></div>` });
}
export { MISS_REASONS };
