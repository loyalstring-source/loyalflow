// Reads .xlsx (first sheet) and .csv files into rows of strings. Dependency-free; enough for import templates.
import { inflateRawSync } from 'node:zlib';

export type Table = { headers: string[]; rows: string[][] };

/** Unzip a (stored or deflated) zip archive into a map of name → bytes. */
export function unzip(buf: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  // find end of central directory
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 70_000); i--) { if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; } }
  if (eocd < 0) throw new Error('Not a zip/xlsx file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10), compSize = buf.readUInt32LE(p + 20), nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32), local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const lNameLen = buf.readUInt16LE(local + 26), lExtraLen = buf.readUInt16LE(local + 28);
    const start = local + 30 + lNameLen + lExtraLen;
    const data = buf.subarray(start, start + compSize);
    out.set(name, method === 8 ? inflateRawSync(data) : Buffer.from(data));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const unesc = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d))).replace(/&amp;/g, '&');

function colIndex(ref: string): number { let n = 0; for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; }

/** Excel serial date → YYYY-MM-DD (for columns that expect dates). */
export function excelSerialToDate(n: number): string { const d = new Date(Math.round((n - 25569) * 86_400_000)); return d.toISOString().slice(0, 10); }

export function parseXlsx(buf: Buffer): Table {
  const files = unzip(buf);
  const wb = files.get('xl/workbook.xml')?.toString('utf8') || '';
  const rels = files.get('xl/_rels/workbook.xml.rels')?.toString('utf8') || '';
  const firstSheet = /<sheet\b[^>]*r:id="([^"]+)"/.exec(wb)?.[1];
  let sheetPath = 'xl/worksheets/sheet1.xml';
  if (firstSheet) { const m = new RegExp(`<Relationship[^>]*Id="${firstSheet}"[^>]*Target="([^"]+)"`).exec(rels) || new RegExp(`<Relationship[^>]*Target="([^"]+)"[^>]*Id="${firstSheet}"`).exec(rels); if (m) sheetPath = 'xl/' + m[1].replace(/^\/?xl\//, '').replace(/^\//, ''); }
  const sheet = files.get(sheetPath)?.toString('utf8');
  if (!sheet) throw new Error('Workbook has no worksheet');
  const shared: string[] = [];
  const ss = files.get('xl/sharedStrings.xml')?.toString('utf8');
  if (ss) for (const m of ss.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(unesc([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')));
  const rows: string[][] = [];
  for (const r of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1]; const inner = c[2] || '';
      const ref = /r="([A-Z]+)\d+"/.exec(attrs)?.[1] || ''; const type = /t="(\w+)"/.exec(attrs)?.[1] || '';
      const idx = ref ? colIndex(ref) : cells.length;
      let v = '';
      if (type === 's') v = shared[Number(/<v>([^<]*)<\/v>/.exec(inner)?.[1] || 0)] || '';
      else if (type === 'inlineStr') v = unesc([...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(''));
      else if (type === 'b') v = /<v>1<\/v>/.test(inner) ? 'true' : 'false';
      else v = unesc(/<v>([^<]*)<\/v>/.exec(inner)?.[1] || '');
      while (cells.length < idx) cells.push('');
      cells[idx] = v.trim();
    }
    rows.push(cells);
  }
  while (rows.length && rows[rows.length - 1].every((c) => !c)) rows.pop();
  const headers = (rows.shift() || []).map((h) => h.trim());
  return { headers, rows: rows.filter((r) => r.some((c) => c)) };
}

export function parseCsv(text: string): Table {
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let q = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) { if (ch === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; continue; }
    if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell.trim()); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && src[i + 1] === '\n') i++; row.push(cell.trim()); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell.trim()); rows.push(row); }
  const headers = (rows.shift() || []).map((h) => h.trim());
  return { headers, rows: rows.filter((r) => r.some((c) => c)) };
}

export function parseTable(filename: string, buf: Buffer): Table {
  if (/\.xlsx$/i.test(filename) || (buf.length > 4 && buf.readUInt32LE(0) === 0x04034b50)) return parseXlsx(buf);
  return parseCsv(buf.toString('utf8'));
}

/** Map a table to objects using case/space-insensitive header matching against the given aliases. */
export function mapRows(table: Table, columns: Record<string, string[]>): { objects: Record<string, string>[]; missing: string[]; matched: Record<string, string> } {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const idx: Record<string, number> = {}; const matched: Record<string, string> = {};
  for (const [key, aliases] of Object.entries(columns)) {
    const i = table.headers.findIndex((h) => [key, ...aliases].map(norm).includes(norm(h)));
    if (i >= 0) { idx[key] = i; matched[key] = table.headers[i]; }
  }
  const missing = Object.keys(columns).filter((k) => !(k in idx));
  const objects = table.rows.map((r) => { const o: Record<string, string> = {}; for (const [k, i] of Object.entries(idx)) o[k] = r[i] ?? ''; return o; });
  return { objects, missing, matched };
}
