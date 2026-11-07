// ASSUMPTIONS.md: unverified claims. Must be empty for a branch before it merges.
import { readText, writeAtomic, splitRow, isSeparatorRow, cell, stamp } from './util.mjs';
import { withLock } from './lock.mjs';

export const COLUMNS = ['Id', 'Opened', 'Branch', 'Area', 'Claim', 'Why unverified', 'Closed'];
const KEYS = ['id', 'opened', 'branch', 'area', 'claim', 'why', 'closed'];

export const TEMPLATE = `# ASSUMPTIONS - unverified claims

A row is opened by the verifier for every claim it could not verify. It closes with a verification id (v-…) or a decision id (d-…).
A branch with open rows does not merge.

| ${COLUMNS.join(' | ')} |
|${COLUMNS.map(() => '---').join('|')}|
`;

export function parse(text) {
  const rows = [];
  if (!text) return rows;
  let inTable = false;
  text.split('\n').forEach((line, idx) => {
    const cells = splitRow(line);
    if (!cells) { inTable = false; return; }
    if (cells[0] === 'Id') { inTable = true; return; }
    if (!inTable || isSeparatorRow(cells) || cells.length !== KEYS.length) return;
    const row = { line: idx };
    KEYS.forEach((k, j) => { row[k] = cells[j] === '-' ? '' : cells[j]; });
    rows.push(row);
  });
  return rows;
}

export function load(ctx) { return parse(readText(ctx.files.assumptions, '')); }

export function openFor(rows, branch) {
  return rows.filter((r) => !r.closed && (!branch || r.branch === branch));
}

export function append(ctx, { branch, area, claim, why }) {
  return withLock(ctx, () => {
    let text = readText(ctx.files.assumptions, null);
    if (text == null || !/^\| Id \|/m.test(text)) text = TEMPLATE;
    const rows = parse(text);
    let max = 0;
    for (const r of rows) { const m = r.id.match(/^a-(\d+)$/); if (m) max = Math.max(max, +m[1]); }
    const id = `a-${String(max + 1).padStart(3, '0')}`;
    const line = `| ${id} | ${stamp()} | ${cell(branch)} | ${cell(area)} | ${cell(claim, 160)} | ${cell(why, 120)} | - |`;
    const lines = text.replace(/\n+$/, '').split('\n');
    let last = -1;
    for (let i = lines.length - 1; i >= 0; i--) { if (splitRow(lines[i])) { last = i; break; } }
    lines.splice(last + 1, 0, line);
    writeAtomic(ctx.files.assumptions, lines.join('\n') + '\n');
    return id;
  });
}

export function close(ctx, id, closedBy) {
  return withLock(ctx, () => {
    const text = readText(ctx.files.assumptions, '');
    const rows = parse(text);
    const row = rows.find((r) => r.id === id);
    if (!row) throw new Error(`no assumption ${id}`);
    const lines = text.split('\n');
    const cells = splitRow(lines[row.line]);
    cells[KEYS.length - 1] = closedBy;
    lines[row.line] = '| ' + cells.join(' | ') + ' |';
    writeAtomic(ctx.files.assumptions, lines.join('\n'));
    return true;
  });
}
