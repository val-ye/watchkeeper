// OWNERSHIP.md: the strict table is the truth. Parse, mutate, render, under lock.
import fs from 'node:fs';
import { readText, writeAtomic, splitRow, isSeparatorRow, cell, stamp } from './util.mjs';
import { withLock } from './lock.mjs';

export const COLUMNS = ['Area', 'Owner', 'Status', 'Since', 'Last touched', 'Branch / worktree', 'Note'];
export const STATUSES = ['orphaned-dirty', 'handoff-pending', 'active', 'idle', 'orphaned-clean', 'released'];
const KEYS = ['area', 'owner', 'status', 'since', 'touched', 'branch', 'note'];

const HEADER = `# OWNERSHIP - who owns what, right now

One row per area. Hooks write it; people may edit it. Claim before editing, decide before releasing.
Status: active / idle / handoff-pending / orphaned-dirty / orphaned-clean / released.
`;

export function emptyBoard() {
  return { header: HEADER, reconciled: '', rows: [], notes: [], orphans: [], sessions: [] };
}

export function parse(text) {
  const b = emptyBoard();
  if (!text) return b;
  const lines = text.split('\n');
  const headerLines = [];
  let i = 0;
  // header prose until the table
  for (; i < lines.length; i++) {
    const cells = splitRow(lines[i]);
    if (cells && cells[0] === 'Area') break;
    if (lines[i].startsWith('Reconciled:')) { b.reconciled = lines[i]; continue; }
    headerLines.push(lines[i]);
  }
  b.header = headerLines.join('\n').replace(/\n+$/, '') + '\n';
  if (i >= lines.length) return b;
  i++; // header row
  if (i < lines.length && isSeparatorRow(splitRow(lines[i]))) i++;
  for (; i < lines.length; i++) {
    const cells = splitRow(lines[i]);
    if (!cells) break;
    if (cells.length !== KEYS.length) { b.notes.push(`unparsed row kept: ${lines[i].trim()}`); continue; }
    const row = {};
    KEYS.forEach((k, j) => { row[k] = cells[j] === '-' ? '' : cells[j]; });
    if (!row.area) continue;
    b.rows.push(row);
  }
  // Notes are preserved. Orphaned worktrees and Live sessions are read back so callers see them; reconcile regenerates both.
  const rest = lines.slice(i);
  let section = null;
  for (const line of rest) {
    if (line.startsWith('## ')) { section = line.slice(3).trim(); continue; }
    if (section === 'Notes') { const n = line.replace(/^- /, '').trim(); if (n) b.notes.push(n); continue; }
    const cells = splitRow(line);
    if (!cells || isSeparatorRow(cells)) continue;
    if (section === 'Orphaned worktrees' && cells.length === 6 && cells[0] !== 'Worktree') {
      b.orphans.push({ path: cells[0], branch: cells[1], dirty: cells[2] === '?' ? null : +cells[2], unpushed: cells[3] === '?' ? null : +cells[3], owner: cells[4], seen: cells[5] });
    } else if (section === 'Live sessions' && cells.length === 6 && cells[0] !== 'Session') {
      b.sessions.push({ short: cells[0], role: cells[1], worktreeName: cells[2], branch: cells[3], heartbeat: cells[4], background: cells[5] === 'yes' });
    }
  }
  return b;
}

function statusRank(s) { const i = STATUSES.indexOf(s); return i === -1 ? STATUSES.length : i; }

export function render(b, { by = 'hook', now = new Date() } = {}) {
  const rows = [...b.rows].sort((x, y) => statusRank(x.status) - statusRank(y.status) || x.area.localeCompare(y.area));
  const out = [];
  out.push(b.header.trimEnd());
  out.push(`Reconciled: ${stamp(now)} by ${by}`);
  out.push('');
  out.push('| ' + COLUMNS.join(' | ') + ' |');
  out.push('|' + COLUMNS.map(() => '---').join('|') + '|');
  for (const r of rows) out.push('| ' + KEYS.map((k) => cell(r[k], k === 'note' ? 80 : 60)).join(' | ') + ' |');
  if (b.orphans.length) {
    out.push('', '## Orphaned worktrees', '');
    out.push('| Worktree | Branch | Uncommitted | Unpushed | Last owner | Seen |', '|---|---|---|---|---|---|');
    for (const o of b.orphans) out.push(`| ${cell(o.path, 160)} | ${cell(o.branch)} | ${o.dirty ?? '?'} | ${o.unpushed ?? '?'} | ${cell(o.owner)} | ${cell(o.seen)} |`);
  }
  if (b.sessions.length) {
    out.push('', '## Live sessions', '');
    out.push('| Session | Role | Worktree | Branch | Heartbeat | Background |', '|---|---|---|---|---|---|');
    for (const s of b.sessions) out.push(`| ${s.short} | ${s.role || 'worker'} | ${cell(s.worktreeName || '-')} | ${cell(s.branch || '-')} | ${s.heartbeat || '-'} | ${s.background ? 'yes' : 'no'} |`);
  }
  if (b.notes.length) {
    out.push('', '## Notes', '');
    for (const n of b.notes) out.push(`- ${n}`);
  }
  return out.join('\n') + '\n';
}

export function load(ctx) { return parse(readText(ctx.files.ownership, '')); }

export function save(ctx, b, opts) { writeAtomic(ctx.files.ownership, render(b, opts)); }

export function find(b, area) { return b.rows.find((r) => r.area === area) || null; }

export function upsert(b, area, patch) {
  let r = find(b, area);
  if (!r) { r = { area, owner: '', status: '', since: '', touched: '', branch: '', note: '' }; b.rows.push(r); }
  Object.assign(r, patch);
  return r;
}

// Mutate the board atomically. fn(board) may return a value; it is passed through.
export function update(ctx, fn, opts = {}) {
  return withLock(ctx, () => {
    const b = load(ctx);
    const result = fn(b);
    if (result !== false) save(ctx, b, opts);
    return result;
  });
}

export function ownedBy(b, short) { return b.rows.filter((r) => r.owner === short && !['released', 'orphaned-clean'].includes(r.status)); }

export function exists(ctx) { return fs.existsSync(ctx.files.ownership); }
