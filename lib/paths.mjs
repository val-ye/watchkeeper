// Resolve where the board lives for the repo that contains cwd.
import fs from 'node:fs';
import path from 'node:path';
import { run, readJson, sha256, homeDir, globToRegExp, log } from './util.mjs';

export const DEFAULT_CONFIG = {
  areas: [],
  base_branch: null,
  ownership: { mode: 'deny', stale_after_minutes: 90 },
  decisions_on_start: 10,
  stop_gate: 'auto',
  nudge_minutes: 30,
  tiers: {
    2: {
      paths: ['**/*.sql', 'db/**', 'sql/**', 'models/**', '**/helm/**', '**/k8s/**', '.github/workflows/**', '**/*.tf', '**/Dockerfile', '**/dags/**'],
      content: ['\\bCREATE\\s+(OR\\s+REPLACE\\s+)?(VIEW|TABLE|MATERIALIZED)', '\\bSELECT\\b[\\s\\S]*\\bFROM\\b', '\\bthreshold', '_pct\\b', '\\bforecast', '\\bprojection', '\\bSAFE_DIVIDE\\b'],
    },
    1: { paths: ['docs/**', '**/*.md', 'README*'], content: [] },
  },
};

export function dataDir() {
  return process.env.CLAUDE_PLUGIN_DATA || path.join(homeDir(), '.claude', 'plugins', 'data', 'watchkeeper');
}

function mergeConfig(user) {
  const c = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  if (!user) return c;
  for (const k of Object.keys(user)) {
    if (k === 'ownership') c.ownership = { ...c.ownership, ...user.ownership };
    else if (k === 'tiers') c.tiers = { ...c.tiers, ...user.tiers };
    else c[k] = user[k];
  }
  return c;
}

// Returns null when cwd is not inside a git repository.
export function resolveContext(cwd = process.cwd()) {
  const top = run('git', ['rev-parse', '--show-toplevel'], { cwd, timeout: 1500 });
  if (!top.ok || !top.out) return null;
  const worktree = fs.realpathSync(top.out);
  const cd = run('git', ['rev-parse', '--git-common-dir'], { cwd, timeout: 1500 });
  let commonDir = cd.ok && cd.out ? cd.out : path.join(worktree, '.git');
  if (!path.isAbsolute(commonDir)) commonDir = path.join(cwd, commonDir);
  try { commonDir = fs.realpathSync(commonDir); } catch { /* keep */ }
  let root;
  if (path.basename(commonDir) === '.git') root = path.dirname(commonDir);
  else root = path.join(dataDir(), 'repos', sha256(commonDir).slice(0, 12));
  const br = run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, timeout: 1500 });
  const wkDir = path.join(root, '.watchkeeper');
  const configPath = path.join(wkDir, 'config.json');
  const userConfig = readJson(configPath, null);
  const ctx = {
    cwd, worktree, commonDir, root, wkDir, configPath,
    initialized: userConfig !== null,
    config: mergeConfig(userConfig),
    branch: br.ok ? br.out : '-',
    worktreeName: worktree === root ? '-' : path.basename(worktree),
    files: {
      ownership: path.join(root, 'OWNERSHIP.md'),
      decisions: path.join(root, 'DECISIONS.md'),
      authorization: path.join(root, 'AUTHORIZATION.md'),
      assumptions: path.join(wkDir, 'ASSUMPTIONS.md'),
      verify: path.join(wkDir, 'VERIFY.md'),
      verifications: path.join(wkDir, 'verifications'),
      local: path.join(wkDir, 'local'),
      sessions: path.join(wkDir, 'local', 'sessions'),
      lock: path.join(wkDir, 'local', 'lock'),
    },
  };
  log('ctx root', root, 'worktree', worktree, 'init', ctx.initialized);
  return ctx;
}

// Repo-relative path for an absolute file, or null if the file is outside this repo.
export function relPath(ctx, absFile) {
  if (!absFile) return null;
  const abs = path.isAbsolute(absFile) ? absFile : path.join(ctx.cwd, absFile);
  let real = abs;
  try { real = fs.realpathSync(abs); } catch { /* new file: realpath the dir */
    try { real = path.join(fs.realpathSync(path.dirname(abs)), path.basename(abs)); } catch { /* keep */ }
  }
  if (real.startsWith(ctx.worktree + path.sep)) return path.relative(ctx.worktree, real);
  if (real.startsWith(ctx.root + path.sep)) return path.relative(ctx.root, real);
  // Another worktree of the same repo?
  const dir = fs.existsSync(path.dirname(real)) ? path.dirname(real) : null;
  if (!dir) return null;
  const top = run('git', ['rev-parse', '--show-toplevel'], { cwd: dir, timeout: 1000 });
  const cd = run('git', ['rev-parse', '--git-common-dir'], { cwd: dir, timeout: 1000 });
  if (!top.ok || !cd.ok) return null;
  let common = cd.out;
  if (!path.isAbsolute(common)) common = path.join(dir, common);
  try { common = fs.realpathSync(common); } catch { /* keep */ }
  if (common !== ctx.commonDir) return null;
  return path.relative(fs.realpathSync(top.out), real);
}

// Map a repo-relative path to an area. Longest configured match wins; fallback is the first path segment.
export function areaFor(ctx, rel) {
  if (!rel) return null;
  const norm = rel.split(path.sep).join('/');
  let best = null;
  for (const a of ctx.config.areas || []) {
    const re = globToRegExp(a);
    if (re.test(norm) && (!best || a.length > best.length)) best = a;
  }
  if (best) return best;
  const i = norm.indexOf('/');
  return i === -1 ? '(root)' : norm.slice(0, i + 1);
}
