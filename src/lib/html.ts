// Tagged-template HTML rendering with automatic escaping.
// `html\`...\`` escapes every interpolated value unless it is already a Raw (another html`` result).

export class Raw {
  readonly s: string;
  constructor(s: string) { this.s = s; }
  toString(): string { return this.s; }
}

export type HtmlValue = string | number | boolean | null | undefined | Raw | HtmlValue[];

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESC[c]);
}

function render(v: HtmlValue): string {
  if (v === null || v === undefined || v === false || v === true) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(render).join('');
  if (typeof v === 'number') return String(v);
  return escape(String(v));
}

export function html(strings: TemplateStringsArray, ...values: HtmlValue[]): Raw {
  let out = '';
  for (let i = 0; i < strings.length; i++) {
    out += strings[i];
    if (i < values.length) out += render(values[i]);
  }
  return new Raw(out);
}

export function raw(s: string): Raw { return new Raw(s); }

export function join(items: HtmlValue[], sep = ''): Raw {
  return new Raw(items.map(render).join(sep));
}

/** Render a value only when the condition holds. */
export function when(cond: unknown, value: HtmlValue | (() => HtmlValue)): Raw {
  if (!cond) return new Raw('');
  return new Raw(render(typeof value === 'function' ? value() : value));
}

/** Build a style/class-safe attribute list from an object; false/null values are omitted. */
export function attrs(obj: Record<string, string | number | boolean | null | undefined>): Raw {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined || v === false) continue;
    if (v === true) { parts.push(k); continue; }
    parts.push(`${k}="${escape(String(v))}"`);
  }
  return new Raw(parts.join(' '));
}

/** Safe JSON for embedding inside a <script> tag. */
export function jsonScript(value: unknown): Raw {
  return new Raw(JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029'));
}
