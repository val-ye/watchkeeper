// Shared helpers. No dependencies. Node 18+.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

export const DEBUG = !!process.env.WATCHKEEPER_DEBUG;

export function log(...args) {
  if (DEBUG) process.stderr.write('[watchkeeper] ' + args.join(' ') + '\n');
}

export function readStdinJson() {
  try {
    const raw = fs.readFileSync(0, 'utf8');
    return raw.trim() ? JSON.parse(raw) : {};
  } catch (e) {
    log('stdin parse failed', e.message);
    return {};
  }
}

export function pad(n) { return String(n).padStart(2, '0'); }

// "YYYY-MM-DD HH:mm" in local time. Sortable, parseable, human-readable.
export function stamp(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function parseStamp(s) {
  if (!s || s === '-') return null;
  const m = String(s).trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0));
}

export function minutesSince(s, now = new Date()) {
  const d = s instanceof Date ? s : parseStamp(s);
  if (!d) return Infinity;
  return (now - d) / 60000;
}

export function shortId(id) { return String(id || 'unknown').replace(/-/g, '').slice(0, 8); }

export function sha256(text) { return crypto.createHash('sha256').update(text).digest('hex'); }

export function readText(p, fallback = null) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return fallback; }
}

export function readJson(p, fallback = null) {
  const t = readText(p);
  if (t == null) return fallback;
  try { return JSON.parse(t); } catch { return fallback; }
}

export function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }

export function writeAtomic(p, text) {
  ensureDir(path.dirname(p));
  const tmp = `${p}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, p);
}

export function writeJson(p, obj) { writeAtomic(p, JSON.stringify(obj, null, 2) + '\n'); }

// Run a command with a hard timeout. Never throws.
export function run(cmd, args, { cwd, timeout = 2000, env, input } = {}) {
  try {
    const out = execFileSync(cmd, args, {
      cwd, timeout, input,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 32 * 1024 * 1024,
      encoding: 'utf8',
    });
    return { ok: true, out: out.replace(/\n$/, ''), err: '' };
  } catch (e) {
    return { ok: false, out: (e.stdout || '').toString().replace(/\n$/, ''), err: (e.stderr || e.message || '').toString() };
  }
}

export function homeDir() { return os.homedir(); }

export function cell(s, max = 80) {
  let t = String(s ?? '-').replace(/\|/g, '/').replace(/\s+/g, ' ').trim();
  if (!t) t = '-';
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

// Markdown table parsing: returns rows as arrays of trimmed cells.
export function splitRow(line) {
  const t = line.trim();
  if (!t.startsWith('|')) return null;
  const inner = t.slice(1, t.endsWith('|') ? -1 : undefined);
  return inner.split('|').map((c) => c.trim());
}

export function isSeparatorRow(cells) {
  return cells && cells.every((c) => /^:?-{3,}:?$/.test(c));
}

// Minimal glob -> RegExp. Supports **, *, ?, {a,b}. Trailing "/" means prefix.
export function globToRegExp(glob) {
  if (glob.endsWith('/')) return new RegExp('^' + escapeRe(glob));
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (glob[i + 1] === '/') { i++; re += '(?:.*/)?'; } else re += '.*';
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if (c === '{') {
      const j = glob.indexOf('}', i);
      if (j > i) { re += '(?:' + glob.slice(i + 1, j).split(',').map(escapeRe).join('|') + ')'; i = j; }
      else re += '\\{';
    } else re += escapeRe(c);
  }
  return new RegExp('^' + re + '$');
}

export function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

export function matchesAny(rel, patterns) {
  return (patterns || []).some((g) => globToRegExp(g).test(rel));
}

export function uniq(arr) { return [...new Set(arr)]; }
