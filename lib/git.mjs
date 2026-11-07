// Git queries with hard timeouts. Every function degrades to null/empty instead of throwing.
import { run, sha256 } from './util.mjs';

const OWN_FILES = /^(OWNERSHIP\.md|DECISIONS\.md|AUTHORIZATION\.md|\.watchkeeper\/)/;

// Dirty-file counts, ignoring watchkeeper's own files so the protocol never flags itself.
export function status(cwd, timeout = 1500) {
  const r = run('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd, timeout });
  if (!r.ok) return null;
  const lines = (r.out ? r.out.split('\n').filter(Boolean) : []).filter((l) => !OWN_FILES.test(l.slice(3).replace(/^"/, '')));
  return { dirty: lines.filter((l) => !l.startsWith('??')).length, untracked: lines.filter((l) => l.startsWith('??')).length, total: lines.length };
}

// Commits not on any remote-tracking ref. A repo with no remote refs at all counts 0: nothing to push to.
export function unpushed(cwd, timeout = 1500) {
  const refs = run('git', ['for-each-ref', '--count=1', 'refs/remotes'], { cwd, timeout });
  if (refs.ok && !refs.out) return 0;
  const r = run('git', ['rev-list', '--count', 'HEAD', '--not', '--remotes'], { cwd, timeout });
  if (!r.ok) return null;
  const n = parseInt(r.out, 10);
  return Number.isFinite(n) ? n : null;
}

export function currentBranch(cwd) {
  const r = run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, timeout: 1500 });
  return r.ok ? r.out : null;
}

function refExists(cwd, ref) {
  return run('git', ['rev-parse', '--verify', '--quiet', ref], { cwd, timeout: 1500 }).ok;
}

// Base branch: config, else origin/HEAD, else develop/main/master.
export function baseBranch(cwd, config = {}) {
  if (config.base_branch) return config.base_branch;
  const h = run('git', ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], { cwd, timeout: 1500 });
  if (h.ok && h.out) return h.out;
  for (const c of ['origin/develop', 'develop', 'origin/main', 'main', 'origin/master', 'master']) {
    if (refExists(cwd, c)) return c;
  }
  return null;
}

export function mergeBase(cwd, base) {
  if (!base) return null;
  const r = run('git', ['merge-base', base, 'HEAD'], { cwd, timeout: 3000 });
  return r.ok ? r.out : null;
}

// Files changed vs base. committedOnly: what a push would carry. Otherwise includes the working tree and untracked files.
export function changedFiles(cwd, base, { committedOnly = false } = {}) {
  const mb = mergeBase(cwd, base);
  const args = ['diff', '--name-only'];
  if (mb) args.push(mb);
  if (committedOnly) args.push(mb ? 'HEAD' : 'HEAD~0');
  const r = run('git', mb || committedOnly ? args : ['diff', '--name-only', 'HEAD'], { cwd, timeout: 5000 });
  let files = r.ok && r.out ? r.out.split('\n').filter(Boolean) : [];
  if (!committedOnly) {
    const u = run('git', ['ls-files', '--others', '--exclude-standard'], { cwd, timeout: 3000 });
    if (u.ok && u.out) files = files.concat(u.out.split('\n').filter(Boolean));
  }
  return { files: [...new Set(files)], mergeBase: mb, base };
}

export function diffText(cwd, base, { committedOnly = false } = {}) {
  const mb = mergeBase(cwd, base);
  const args = ['diff', '--no-color', '--no-ext-diff'];
  if (mb) args.push(mb);
  if (committedOnly && mb) args.push('HEAD');
  const r = run('git', mb ? args : (committedOnly ? ['show', '--no-color', '--format=', 'HEAD'] : ['diff', '--no-color', 'HEAD']), { cwd, timeout: 10000 });
  let text = r.ok ? r.out : '';
  if (!committedOnly) {
    const u = run('git', ['ls-files', '--others', '--exclude-standard'], { cwd, timeout: 3000 });
    for (const f of (u.ok && u.out ? u.out.split('\n').filter(Boolean) : [])) {
      const c = run('cat', [f], { cwd, timeout: 1000 });
      if (c.ok) text += `\ndiff --git a/${f} b/${f}\n--- /dev/null\n+++ b/${f}\n` + c.out.split('\n').map((l) => '+' + l).join('\n') + '\n';
    }
  }
  return text;
}

// Stable hash of a diff: only added/removed lines, whitespace collapsed. Insensitive to index lines and hunk headers.
export function diffHash(text) {
  const lines = (text || '').split('\n').filter((l) => (l.startsWith('+') || l.startsWith('-')) && !l.startsWith('+++') && !l.startsWith('---'));
  return sha256(lines.map((l) => l.replace(/\s+/g, ' ').trimEnd()).join('\n')).slice(0, 16);
}

// Split a unified diff into { file: addedLinesText }.
export function addedLinesByFile(text) {
  const out = {};
  let cur = null;
  for (const line of (text || '').split('\n')) {
    const m = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (m) { cur = m[2]; out[cur] = out[cur] || []; continue; }
    if (cur && line.startsWith('+') && !line.startsWith('+++')) out[cur].push(line.slice(1));
  }
  for (const k of Object.keys(out)) out[k] = out[k].join('\n');
  return out;
}

export function worktrees(cwd) {
  const r = run('git', ['worktree', 'list', '--porcelain'], { cwd, timeout: 3000 });
  if (!r.ok) return [];
  const list = [];
  let cur = null;
  for (const line of r.out.split('\n')) {
    if (line.startsWith('worktree ')) { cur = { path: line.slice(9), branch: null, bare: false }; list.push(cur); }
    else if (cur && line.startsWith('branch ')) cur.branch = line.slice(7).replace('refs/heads/', '');
    else if (cur && line === 'bare') cur.bare = true;
  }
  return list;
}
