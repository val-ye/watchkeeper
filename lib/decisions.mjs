// DECISIONS.md: append-only. The script can only add a row at the end; edits to earlier rows are detected and flagged.
import fs from 'node:fs';
import path from 'node:path';
import { readText, writeAtomic, splitRow, isSeparatorRow, cell, stamp, sha256, readJson, writeJson } from './util.mjs';
import { withLock } from './lock.mjs';

export const COLUMNS = ['Id', 'Date', 'Area', 'Decision', 'Basis', 'By', 'Supersedes'];
const KEYS = ['id', 'date', 'area', 'decision', 'basis', 'by', 'supersedes'];

export const TEMPLATE = `# DECISIONS - append-only

One row per decision. Newest at the bottom. Never edit a row; add a new one with Supersedes set.
OPEN rows are questions waiting for a human; they list every date the question was raised.
Grep here before re-arguing a design question.

| ${COLUMNS.join(' | ')} |
|${COLUMNS.map(() => '---').join('|')}|
`;

export function parse(text) {
  const rows = [];
  if (!text) return { rows, lines: [] };
  const lines = text.split('\n');
  let inTable = false;
  lines.forEach((line, idx) => {
    const cells = splitRow(line);
    if (!cells) { inTable = false; return; }
    if (cells[0] === 'Id') { inTable = true; return; }
    if (!inTable || isSeparatorRow(cells)) return;
    if (cells.length !== KEYS.length) return;
    const row = { line: idx };
    KEYS.forEach((k, j) => { row[k] = cells[j] === '-' ? '' : cells[j]; });
    rows.push(row);
  });
  return { rows, lines };
}

export function load(ctx) { return parse(readText(ctx.files.decisions, '')); }

export function nextId(rows) {
  let max = 0;
  for (const r of rows) { const m = r.id.match(/^d-(\d+)$/); if (m) max = Math.max(max, +m[1]); }
  return `d-${String(max + 1).padStart(4, '0')}`;
}

export function supersededIds(rows) {
  return new Set(rows.map((r) => r.supersedes).filter(Boolean).flatMap((s) => s.split(/[ ,]+/)));
}

function shaPath(ctx) { return path.join(ctx.files.local, 'decisions.sha.json'); }

function rowsText(lines, rows) { return rows.map((r) => lines[r.line]).join('\n'); }

// Compare the rows that existed at the last append with the file now. Pure appends pass; anything else is reported.
export function integrity(ctx) {
  const { rows, lines } = load(ctx);
  const saved = readJson(shaPath(ctx), null);
  if (!saved) return { ok: true, checked: 0 };
  const prefix = rows.slice(0, saved.count);
  if (prefix.length < saved.count) return { ok: false, reason: `rows removed: expected ${saved.count}, found ${rows.length}` };
  const h = sha256(rowsText(lines, prefix));
  return h === saved.sha ? { ok: true, checked: saved.count } : { ok: false, reason: `an earlier row was edited (first ${saved.count} rows no longer match)` };
}

function recordIntegrity(ctx) {
  const { rows, lines } = load(ctx);
  writeJson(shaPath(ctx), { count: rows.length, sha: sha256(rowsText(lines, rows)), at: stamp() });
}

// Append one row. open=true writes an OPEN question. Returns the new row id.
export function append(ctx, { area, decision, basis = '', by = '', supersedes = '', open = false }) {
  if (!decision || !decision.trim()) throw new Error('decision text is required');
  return withLock(ctx, () => {
    let text = readText(ctx.files.decisions, null);
    if (text == null || !/^\| Id \|/m.test(text)) text = TEMPLATE;
    const { rows } = parse(text);
    if (supersedes) {
      for (const id of supersedes.split(/[ ,]+/).filter(Boolean)) {
        if (!rows.some((r) => r.id === id)) throw new Error(`supersedes ${id}: no such decision`);
      }
    }
    const id = open ? 'OPEN' : nextId(rows);
    const row = { id, date: stamp(), area: area || '-', decision, basis, by, supersedes: supersedes || '-' };
    const line = '| ' + KEYS.map((k) => cell(row[k], k === 'decision' ? 200 : 100)).join(' | ') + ' |';
    const lines = text.replace(/\n+$/, '').split('\n');
    let last = -1;
    for (let i = lines.length - 1; i >= 0; i--) { if (splitRow(lines[i])) { last = i; break; } }
    if (last === -1) throw new Error('DECISIONS.md has no table');
    lines.splice(last + 1, 0, line);
    writeAtomic(ctx.files.decisions, lines.join('\n') + '\n');
    recordIntegrity(ctx);
    return id;
  });
}

export function recent(rows, n) { return rows.filter((r) => r.id !== 'OPEN').slice(-n); }
export function openRows(rows) { return rows.filter((r) => r.id === 'OPEN'); }
export function exists(ctx) { return fs.existsSync(ctx.files.decisions); }

// Rows dated at or after `since` (Date).
export function since(rows, sinceDate) {
  if (!sinceDate) return rows;
  return rows.filter((r) => { const m = r.date.match(/^(\d{4})-(\d{2})-(\d{2})[ T]?(\d{2})?:?(\d{2})?/); if (!m) return false; return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)) >= sinceDate; });
}
