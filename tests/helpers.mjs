import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

export const PLUGIN_ROOT = path.resolve(new URL('..', import.meta.url).pathname);

export function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).trim();
}

// A temp repo with a develop branch, one commit, and (optionally) a linked worktree on a feature branch.
export function makeRepo({ worktree = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wk-'));
  const root = fs.realpathSync(dir);
  git(root, 'init', '-q', '-b', 'develop');
  fs.mkdirSync(path.join(root, 'src/pricing'), { recursive: true });
  fs.mkdirSync(path.join(root, 'db/views'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/pricing/tiers.js'), 'export const tiers = [1, 2];\n');
  fs.writeFileSync(path.join(root, 'db/views/rollup.sql'), 'SELECT 1 AS x FROM t;\n');
  fs.writeFileSync(path.join(root, 'README.md'), '# demo\n');
  git(root, 'add', '.');
  git(root, 'commit', '-q', '-m', 'init');
  let wt = null;
  if (worktree) {
    wt = path.join(root, '.wt', 'feature');
    git(root, 'worktree', 'add', '-q', '-b', 'feat/x', wt);
  }
  return { root, wt };
}

export function initRepo(root, extra = []) {
  return cli(root, 'init', ...extra);
}

export function cli(cwd, ...args) {
  const r = spawnSync(process.execPath, [path.join(PLUGIN_ROOT, 'bin/wk.mjs'), ...args], { cwd, encoding: 'utf8', env: { ...process.env, WATCHKEEPER_BACKGROUND: '0' } });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

export function hook(name, input, { cwd, env = {} } = {}) {
  const r = spawnSync(process.execPath, [path.join(PLUGIN_ROOT, 'hooks', `${name}.mjs`)], { cwd: cwd || input.cwd, input: JSON.stringify(input), encoding: 'utf8', env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, WATCHKEEPER_BACKGROUND: '0', ...env } });
  let json = null;
  try { json = JSON.parse(r.stdout.trim()); } catch { /* text */ }
  return { code: r.status, out: r.stdout, err: r.stderr, json };
}

export function read(p) { return fs.readFileSync(p, 'utf8'); }
export const SID_A = 'aaaaaaaa-1111-2222-3333-444444444444';
export const SID_B = 'bbbbbbbb-1111-2222-3333-444444444444';
