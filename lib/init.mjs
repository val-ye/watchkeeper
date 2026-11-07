// Initialize a repository: files from templates, local excludes, no commits.
import fs from 'node:fs';
import path from 'node:path';
import { readText, writeAtomic, ensureDir } from './util.mjs';
import * as decisions from './decisions.mjs';
import * as assumptions from './assumptions.mjs';
import * as board from './board.mjs';

const VERIFY_TEMPLATE = `# VERIFY - how to verify a change in this repository

The verifier reads this before it starts. Keep it concrete: commands it may run, sources of truth, what "verified" means here.

## Sources of truth
- (example) Row counts: compare against <table or file>.
- (example) Thresholds: the only valid values are the ones in <config path>.

## Commands the verifier may run (read-only)
- (example) \`npm test\`
- (example) \`<dry-run query command>\`

## Never
- Write to production. Change code. Guess.
`;

const README_LOCAL = `Local state for watchkeeper. Never committed.
sessions/   one JSON per Claude Code session (heartbeat, worktree, branch)
lock/       board write lock
`;

function addExcludes(root, entries) {
  const p = path.join(root, '.git', 'info', 'exclude');
  if (!fs.existsSync(path.dirname(p))) return false;
  const cur = readText(p, '') || '';
  const lines = cur.split('\n');
  const add = entries.filter((e) => !lines.includes(e));
  if (add.length) fs.writeFileSync(p, cur.replace(/\n?$/, '\n') + '# watchkeeper\n' + add.join('\n') + '\n');
  return add;
}

export function init(ctx, { local = false, mode = 'deny', areas = [], base = null } = {}) {
  const created = [];
  const wk = ctx.wkDir;
  ensureDir(path.join(wk, 'local', 'sessions'));
  ensureDir(path.join(wk, 'verifications'));
  if (!fs.existsSync(ctx.configPath)) {
    const cfg = { areas, ownership: { mode, stale_after_minutes: 90 }, decisions_on_start: 10, stop_gate: 'auto' };
    if (base) cfg.base_branch = base;
    writeAtomic(ctx.configPath, JSON.stringify(cfg, null, 2) + '\n');
    created.push(ctx.configPath);
  }
  if (!fs.existsSync(ctx.files.verify)) { writeAtomic(ctx.files.verify, VERIFY_TEMPLATE); created.push(ctx.files.verify); }
  if (!fs.existsSync(ctx.files.assumptions)) { writeAtomic(ctx.files.assumptions, assumptions.TEMPLATE); created.push(ctx.files.assumptions); }
  if (!fs.existsSync(ctx.files.decisions)) { writeAtomic(ctx.files.decisions, decisions.TEMPLATE); created.push(ctx.files.decisions); }
  if (!fs.existsSync(ctx.files.ownership)) { board.save(ctx, board.emptyBoard(), { by: 'init' }); created.push(ctx.files.ownership); }
  writeAtomic(path.join(wk, 'local', 'README'), README_LOCAL);
  const excludes = ['OWNERSHIP.md', '.watchkeeper/local/'];
  if (local) excludes.push('DECISIONS.md', 'AUTHORIZATION.md', '.watchkeeper/');
  const added = addExcludes(ctx.root, excludes);
  return { created, excluded: added || [], local };
}
