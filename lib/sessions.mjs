// Session records: who is alive, where, since when. Local only, never committed.
import fs from 'node:fs';
import path from 'node:path';
import { readJson, writeJson, stamp, minutesSince, shortId, run, log } from './util.mjs';

function file(ctx, id) { return path.join(ctx.files.sessions, `${shortId(id)}.json`); }

export function load(ctx, id) { return readJson(file(ctx, id), null); }

export function save(ctx, rec) { writeJson(file(ctx, rec.id), rec); return rec; }

export function start(ctx, id, extra = {}) {
  const prev = load(ctx, id) || {};
  const rec = {
    id, short: shortId(id), role: prev.role || process.env.WATCHKEEPER_ROLE || 'worker',
    cwd: ctx.cwd, worktree: ctx.worktree, worktreeName: ctx.worktreeName, branch: ctx.branch,
    started: prev.started || stamp(), heartbeat: stamp(), edits: prev.edits || 0,
    last_decision_at: prev.last_decision_at || '', last_nudge_at: prev.last_nudge_at || '',
    background: prev.background ?? false, ended: false, tier: prev.tier ?? null,
    ...extra,
  };
  return save(ctx, rec);
}

export function touch(ctx, id, patch = {}) {
  const rec = load(ctx, id) || start(ctx, id);
  Object.assign(rec, { heartbeat: stamp(), ended: false }, patch);
  return save(ctx, rec);
}

export function end(ctx, id, reason = '') {
  const rec = load(ctx, id);
  if (!rec) return null;
  rec.ended = true; rec.ended_at = stamp(); rec.end_reason = reason;
  return save(ctx, rec);
}

export function all(ctx) {
  let names = [];
  try { names = fs.readdirSync(ctx.files.sessions).filter((n) => n.endsWith('.json')); } catch { return []; }
  return names.map((n) => readJson(path.join(ctx.files.sessions, n), null)).filter(Boolean);
}

export function isLive(rec, config, now = new Date()) {
  if (!rec || rec.ended) return false;
  return minutesSince(rec.heartbeat, now) < (config.ownership?.stale_after_minutes ?? 90);
}

export function live(ctx, now = new Date()) { return all(ctx).filter((r) => isLive(r, ctx.config, now)); }

export function remove(ctx, id) { try { fs.unlinkSync(file(ctx, id)); } catch { /* ignore */ } }

// Is this session one of Claude Code's background sessions? Uses `claude agents --json`. Fails to false.
export function detectBackground(sessionId) {
  if (process.env.WATCHKEEPER_BACKGROUND === '1') return { background: true, name: process.env.WATCHKEEPER_NAME || '' };
  if (process.env.WATCHKEEPER_BACKGROUND === '0') return { background: false, name: '' };
  const r = run('claude', ['agents', '--json'], { timeout: 2500, cwd: process.env.HOME });
  if (!r.ok) { log('claude agents failed', r.err.slice(0, 100)); return { background: false, name: '', unknown: true }; }
  try {
    const list = JSON.parse(r.out);
    const me = list.find((a) => a.sessionId === sessionId || a.id === sessionId);
    return { background: !!me && me.kind !== 'interactive', name: me?.name || '', kind: me?.kind };
  } catch { return { background: false, name: '', unknown: true }; }
}

// Session ids Claude Code currently reports as running (any kind). Null when unknown.
export function runningSessionIds() {
  const r = run('claude', ['agents', '--json'], { timeout: 2500, cwd: process.env.HOME });
  if (!r.ok) return null;
  try { return new Set(JSON.parse(r.out).filter((a) => a.state !== 'stopped').map((a) => a.sessionId).filter(Boolean)); } catch { return null; }
}

// Map the Claude Code process pid to its session id, so the CLI (run from a skill or the Bash tool) finds the same session the hooks use.
export function recordPid(ctx, pid, sessionId) {
  if (!pid) return;
  const dir = path.join(ctx.files.local, 'pids');
  writeJson(path.join(dir, `${pid}.json`), { pid, sessionId, at: stamp() });
}

function parentOf(pid) {
  const r = run('ps', ['-o', 'ppid=', '-p', String(pid)], { timeout: 1000 });
  const n = parseInt((r.out || '').trim(), 10);
  return r.ok && Number.isFinite(n) && n > 1 ? n : null;
}

export function sessionFromPid(ctx, startPid = process.ppid) {
  let pid = startPid;
  for (let i = 0; i < 6 && pid; i++) {
    const rec = readJson(path.join(ctx.files.local, 'pids', `${pid}.json`), null);
    if (rec?.sessionId) return rec.sessionId;
    pid = parentOf(pid);
  }
  return null;
}
