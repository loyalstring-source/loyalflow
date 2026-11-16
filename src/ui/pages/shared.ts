import { html, when, type Raw } from '../../lib/html.ts';
import { icon, ring, pill, empty } from '../components.ts';
import { instanceSteps, type SopInstance } from '../../modules/sops/service.ts';
import { fmtTime, fmtDate } from '../../lib/time.ts';

/** Interactive SOP checklist: ticking a step posts to the server; evidence is asked for inline. */
export function sopChecklist(inst: SopInstance, opts: { compact?: boolean; now?: Date; canEdit?: boolean } = {}): Raw {
  const steps = instanceSteps(inst);
  const done = steps.filter((s) => s.done).length;
  const pct = steps.length ? Math.round((done / steps.length) * 100) : 0;
  const now = (opts.now || new Date()).toISOString();
  const late = inst.status === 'open' && inst.due_at < now;
  const tone = inst.status === 'complete' ? 'good' : late ? 'crit' : pct >= 50 ? 'accent' : 'warn';
  const canEdit = opts.canEdit !== false;
  return html`<div class="card sop" id="${inst.id}" style="display:flex;flex-direction:column;gap:10px;padding:16px 20px">
    <div class="row between" style="align-items:flex-start">
      <div style="min-width:0;flex:1"><div class="row" style="gap:8px"><h3>${inst.sop_name}</h3>${inst.status === 'complete' ? pill('Done', 'good') : late ? pill('Overdue', 'crit') : pill(`Due ${fmtTime(inst.due_at)}`, 'ink')}${when(inst.escalation_level > 0, pill(`Escalated L${inst.escalation_level}`, 'crit'))}</div>
        <div class="small muted">${fmtDate(inst.date)}${when(inst.assignee_name && !opts.compact, () => html` · ${inst.assignee_name}`)}${when(inst.department_name && !opts.compact, () => html` · ${inst.department_name}`)}</div></div>
      ${ring(pct, { size: 52, stroke: 6, tone, label: `${done}/${steps.length}` })}
    </div>
    <div>${steps.map((s) => {
      const needsEvidence = s.evidence !== 'none' && s.evidence !== 'record';
      const stepLate = !s.done && s.dueAt < now;
      return html`<div class="check ${s.done ? 'done' : ''}">
        <input type="checkbox" id="${inst.id}-${s.key}" ${when(s.done, 'checked')} ${when(!canEdit, 'disabled')} data-post="/sop-runs/${inst.id}/steps/${s.key}" data-body="${JSON.stringify({ done: !s.done })}" ${when(!s.done && needsEvidence, () => html`data-prompt="${s.evidence === 'call' ? 'Who did you call and what was agreed?' : s.evidence === 'file' ? 'Paste the file name or link as evidence' : 'Add a short note as evidence'}" data-prompt-key="evidence"`)}>
        <label for="${inst.id}-${s.key}"><span>${s.title}</span>
          <span class="small faint" style="display:block">${s.done ? html`Done ${fmtTime(s.doneAt)}${when(s.onTime === false, () => html` <span class="c-warn">(late)</span>`)}${when(s.evidenceText, () => html` · ${s.evidenceText}`)}` : html`<span class="${stepLate ? 'c-crit' : ''}">${stepLate ? 'Overdue, was due' : 'Due'} ${fmtTime(s.dueAt)}</span>${when(needsEvidence, () => html` · needs ${s.evidence === 'call' ? 'call summary' : s.evidence}`)}`}</span>
        </label>
      </div>`;
    })}</div>
  </div>`;
}

export function sectionHead(title: Raw | string, right?: Raw): Raw {
  return html`<div class="card-head"><h2>${title}</h2>${when(right, right)}</div>`;
}

export function quickAction(label: string, iconName: string, attrs: { href?: string; modal?: string; post?: string; gps?: boolean; body?: unknown }): Raw {
  const inner = html`<span class="ico">${icon(iconName, 18)}</span><span>${label}</span>`;
  if (attrs.href) return html`<a class="qa" href="${attrs.href}">${inner}</a>`;
  return html`<button class="qa" type="button" ${when(attrs.modal, () => html`data-modal="${attrs.modal}"`)} ${when(attrs.post, () => html`data-post="${attrs.post}"`)} ${when(attrs.gps, 'data-gps')} ${when(attrs.body !== undefined, () => html`data-body="${JSON.stringify(attrs.body)}"`)}>${inner}</button>`;
}

export { empty };
