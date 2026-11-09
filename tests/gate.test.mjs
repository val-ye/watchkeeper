import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeRepo, initRepo, hook, cli, read, SID_A, git } from './helpers.mjs';
import { resolveContext } from '../lib/paths.mjs';
import * as verifications from '../lib/verifications.mjs';
import * as authorization from '../lib/authorization.mjs';
import { classifyFiles } from '../lib/tiers.mjs';
import { DEFAULT_CONFIG } from '../lib/paths.mjs';

test('tier classification by path and content', () => {
  const c = classifyFiles(DEFAULT_CONFIG, ['db/views/a.sql', 'README.md', 'src/x.js'], { 'src/x.js': 'const threshold = 5;' });
  assert.equal(c.tier, 2);
  assert.ok(c.triggers.some((t) => t.file === 'src/x.js' && /content/.test(t.reason)));
  assert.equal(classifyFiles(DEFAULT_CONFIG, ['README.md'], {}).tier, 1);
  assert.equal(classifyFiles(DEFAULT_CONFIG, ['src/x.js'], { 'src/x.js': 'let a = 1;' }).tier, 0);
});

test('push of a Tier 2 change is denied without a record and allowed with one; merge blocked by open assumptions', () => {
  const { root, wt } = makeRepo();
  initRepo(root);
  hook('session-start', { session_id: SID_A, cwd: wt, source: 'startup' });
  fs.appendFileSync(path.join(wt, 'db/views/rollup.sql'), 'SELECT 2 AS y FROM u;\n');
  git(wt, 'commit', '-q', '-am', 'sql change');
  let r = hook('pre-bash', { session_id: SID_A, cwd: wt, tool_name: 'Bash', tool_input: { command: 'git push -u origin feat/x' } });
  assert.equal(r.json.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(r.json.hookSpecificOutput.permissionDecisionReason, /Tier 2/);
  // prepare + write a valid record
  const prep = cli(wt, 'verify-prepare', '--committed');
  assert.equal(prep.code, 0, prep.err);
  const hash = prep.out.match(/DIFF_HASH: (\w+)/)[1];
  const recordPath = prep.out.match(/RECORD_PATH: (.+)/)[1];
  fs.writeFileSync(recordPath, `diff_hash: ${hash}\nbranch: feat/x\ntier: 2\n\n## Claims\n- verified: view parses. Evidence: ran sqlite3 :memory: < rollup.sql, exit 0.\n- unverified: row count matches source; no source table reachable from this machine. Registered.\n\n## Verdict\nstatus: unverified-claims-present (1)\n`);
  // SubagentStop validates and registers the assumption
  r = hook('subagent-stop', { session_id: SID_A, cwd: wt, agent_type: 'watchkeeper:verifier' });
  assert.equal(r.code, 0, r.err);
  assert.match(read(path.join(root, '.watchkeeper/ASSUMPTIONS.md')), /\| a-001 \| .* \| feat\/x \| db \| row count matches source/);
  r = hook('pre-bash', { session_id: SID_A, cwd: wt, tool_name: 'Bash', tool_input: { command: 'git push' } });
  assert.equal(r.json.hookSpecificOutput.permissionDecision, 'allow');
  assert.match(r.json.hookSpecificOutput.additionalContext, /1 unverified/);
  // merge is blocked by the open assumption (gh is not needed: falls back to the current branch)
  r = hook('pre-bash', { session_id: SID_A, cwd: wt, tool_name: 'Bash', tool_input: { command: 'gh pr merge --merge' } }, { env: { WATCHKEEPER_GH_BIN: '/nonexistent/gh' } });
  assert.equal(r.json.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(r.json.hookSpecificOutput.permissionDecisionReason, /open assumption/);
  // close it with a decision and merge passes the assumptions check (worker role, no mandate needed)
  cli(wt, 'close-assumption', 'a-001', 'd-0001');
  r = hook('pre-bash', { session_id: SID_A, cwd: wt, tool_name: 'Bash', tool_input: { command: 'gh pr merge --merge' } }, { env: { WATCHKEEPER_GH_BIN: '/nonexistent/gh' } });
  assert.equal(r.json, null);
});

test('verifier record validation rejects confidence language and missing evidence', () => {
  const bad = `diff_hash: abc\n## Claims\n- verified: it works.\n- likely: fine\n- unverified: x; 85% confident it is right\n## Verdict\nstatus: verified\n`;
  const v = verifications.validate(bad, { expectedHash: 'abc' });
  assert.equal(v.ok, false);
  assert.ok(v.problems.some((p) => /without "Evidence:"/.test(p)));
  assert.ok(v.problems.some((p) => /label "likely"/.test(p)));
  assert.ok(v.problems.some((p) => /confidence language/.test(p)));
  const good = `diff_hash: abc\n## Claims\n- verified: compiles. Evidence: node --check x.js exit 0.\n## Verdict\nstatus: verified\n`;
  assert.equal(verifications.validate(good, { expectedHash: 'abc' }).ok, true);
  assert.equal(verifications.validate(good, { expectedHash: 'zzz' }).ok, false);
});

test('authorization validates expiry, branches, authors, caps, revocation', () => {
  const a = authorization.parse(authorization.template({ grantedBy: 'val', expiresAt: '2999-01-01 00:00', branches: 'develop', authors: 'p-valye', maxMerges: 2 }));
  assert.equal(authorization.validate(a, { targetBranch: 'develop', authors: ['p-valye'] }).ok, true);
  assert.equal(authorization.validate(a, { targetBranch: 'main', authors: ['p-valye'] }).ok, false);
  assert.ok(authorization.validate(a, { targetBranch: 'develop', authors: ['stranger'] }).reasons[0].includes('stranger'));
  assert.equal(authorization.validate(a, { targetBranch: 'develop', authors: ['p-valye'], mergesSoFar: 2 }).ok, false);
  const expired = authorization.parse(authorization.template({ grantedBy: 'val', expiresAt: '2000-01-01 00:00' }));
  assert.match(authorization.validate(expired, { targetBranch: 'develop' }).reasons.join(), /expired/);
  const revoked = authorization.parse(a.raw + 'revoked_at: 2026-01-01 00:00\n');
  assert.match(authorization.validate(revoked, { targetBranch: 'develop' }).reasons.join(), /revoked/);
  assert.equal(authorization.validate(null).ok, false);
});

test('manager merge is refused without a mandate and without gh', () => {
  const { root } = makeRepo({ worktree: false });
  initRepo(root);
  hook('session-start', { session_id: SID_A, cwd: root, source: 'startup' });
  cli(root, 'role', 'manager', '--session', SID_A);
  const r = hook('pre-bash', { session_id: SID_A, cwd: root, tool_name: 'Bash', tool_input: { command: 'gh pr merge 12 --merge' } }, { env: { WATCHKEEPER_GH_BIN: '/nonexistent/gh' } });
  assert.equal(r.json.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(r.json.hookSpecificOutput.permissionDecisionReason, /Manager merge refused/);
});

test('handoff summary runs and lists orphans first', () => {
  const { root, wt } = makeRepo();
  initRepo(root);
  hook('session-start', { session_id: SID_A, cwd: wt, source: 'startup' });
  const file = path.join(wt, 'src/pricing/tiers.js');
  fs.appendFileSync(file, '// z\n');
  hook('post-edit', { session_id: SID_A, cwd: wt, tool_name: 'Edit', tool_input: { file_path: file } });
  hook('session-end', { session_id: SID_A, cwd: wt, reason: 'other' });
  const r = cli(root, 'handoff');
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /## First\n1\. Orphaned worktree .*feature on feat\/x: 1 uncommitted/);
  assert.doesNotMatch(r.out, /\d+%/);
});

test('lock: two concurrent writers both land', async () => {
  const { root } = makeRepo({ worktree: false });
  initRepo(root);
  const { spawn } = await import('node:child_process');
  const runs = ['a', 'b', 'c', 'd'].map((n) => new Promise((res) => {
    const p = spawn(process.execPath, [path.join(process.cwd(), 'bin/wk.mjs'), 'claim', `${n}/`, '--session', `${n}${n}${n}${n}${n}${n}${n}${n}-0000`], { cwd: root, env: { ...process.env, WATCHKEEPER_BACKGROUND: '0' } });
    p.on('close', (code) => res(code));
  }));
  const codes = await Promise.all(runs);
  assert.deepEqual(codes, [0, 0, 0, 0]);
  const board = read(path.join(root, 'OWNERSHIP.md'));
  for (const n of ['a', 'b', 'c', 'd']) assert.match(board, new RegExp(`\\| ${n}/ \\| ${n}{8} \\| active`));
});

test('unverified claim splits into claim and reason; CLI pseudo-sessions are not persisted', async () => {
  const { root } = makeRepo({ worktree: false });
  initRepo(root);
  const r = cli(root, 'claim', 'src/');
  assert.equal(r.code, 0, r.err);
  assert.equal(fs.readdirSync(path.join(root, '.watchkeeper/local/sessions')).length, 0, 'no record for cli-* ids');
  const { newestPending } = await import('../lib/verifications.mjs');
  assert.equal(newestPending(resolveContext(root)), null);
});
