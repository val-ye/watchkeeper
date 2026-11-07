import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeRepo, initRepo, hook, cli, read, SID_A, SID_B, git } from './helpers.mjs';

test('hooks are silent in an uninitialized repo', () => {
  const { root } = makeRepo({ worktree: false });
  const r = hook('session-start', { session_id: SID_A, cwd: root, hook_event_name: 'SessionStart', source: 'startup' });
  assert.equal(r.code, 0); assert.equal(r.out, '');
});

test('session start prints board context and registers the session', () => {
  const { root } = makeRepo({ worktree: false });
  initRepo(root);
  const r = hook('session-start', { session_id: SID_A, cwd: root, hook_event_name: 'SessionStart', source: 'startup' });
  assert.equal(r.code, 0);
  assert.match(r.out, /\[watchkeeper\] Board for/);
  assert.match(r.out, /You are session aaaaaaaa/);
  assert.ok(fs.existsSync(path.join(root, '.watchkeeper/local/sessions/aaaaaaaa.json')));
});

test('first edit auto-claims; a second live session is denied; stale owner downgrades to a warning', () => {
  const { root, wt } = makeRepo();
  initRepo(root);
  hook('session-start', { session_id: SID_A, cwd: wt, source: 'startup' });
  const file = path.join(wt, 'src/pricing/tiers.js');
  let r = hook('pre-edit', { session_id: SID_A, cwd: wt, tool_name: 'Edit', tool_input: { file_path: file } });
  assert.equal(r.json, null, 'unowned area: no output');
  r = hook('post-edit', { session_id: SID_A, cwd: wt, tool_name: 'Edit', tool_input: { file_path: file } });
  const board = read(path.join(root, 'OWNERSHIP.md'));
  assert.match(board, /\| src\/ \| aaaaaaaa \| active \|/);
  assert.match(board, /feat\/x @ feature/);
  // session B from the primary worktree
  hook('session-start', { session_id: SID_B, cwd: root, source: 'startup' });
  r = hook('pre-edit', { session_id: SID_B, cwd: root, tool_name: 'Write', tool_input: { file_path: path.join(root, 'src/pricing/other.js') } });
  assert.equal(r.json.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(r.json.hookSpecificOutput.permissionDecisionReason, /owned by session aaaaaaaa/);
  // B can edit another area
  r = hook('pre-edit', { session_id: SID_B, cwd: root, tool_name: 'Write', tool_input: { file_path: path.join(root, 'db/views/x.sql') } });
  assert.equal(r.json, null);
  // make A stale
  const recPath = path.join(root, '.watchkeeper/local/sessions/aaaaaaaa.json');
  const rec = JSON.parse(read(recPath)); rec.heartbeat = '2020-01-01 00:00'; fs.writeFileSync(recPath, JSON.stringify(rec));
  r = hook('pre-edit', { session_id: SID_B, cwd: root, tool_name: 'Write', tool_input: { file_path: path.join(root, 'src/pricing/other.js') } });
  assert.equal(r.json.hookSpecificOutput.permissionDecision, 'allow');
  assert.match(r.json.hookSpecificOutput.additionalContext, /not alive/);
});

test('DECISIONS.md cannot be edited through the Edit tool', () => {
  const { root } = makeRepo({ worktree: false });
  initRepo(root);
  const r = hook('pre-edit', { session_id: SID_A, cwd: root, tool_name: 'Edit', tool_input: { file_path: path.join(root, 'DECISIONS.md') } });
  assert.equal(r.json.hookSpecificOutput.permissionDecision, 'deny');
});

test('session end marks dirty worktree orphaned, clean+decided releases, clean+undecided is handoff-pending', () => {
  const { root, wt } = makeRepo();
  initRepo(root);
  const file = path.join(wt, 'src/pricing/tiers.js');
  hook('session-start', { session_id: SID_A, cwd: wt, source: 'startup' });
  fs.appendFileSync(file, '// change\n');
  hook('post-edit', { session_id: SID_A, cwd: wt, tool_name: 'Edit', tool_input: { file_path: file } });
  hook('session-end', { session_id: SID_A, cwd: wt, reason: 'other' });
  let board = read(path.join(root, 'OWNERSHIP.md'));
  assert.match(board, /\| src\/ \| aaaaaaaa \| orphaned-dirty \|.*1 uncommitted/);
  // commit, start again, end without decision -> handoff-pending
  git(wt, 'add', '.'); git(wt, 'commit', '-q', '-m', 'c');
  git(root, 'update-ref', 'refs/remotes/origin/develop', git(root, 'rev-parse', 'develop')); // a remote exists from here on
  hook('session-start', { session_id: SID_A, cwd: wt, source: 'resume' });
  fs.appendFileSync(file, '// c2\n');
  hook('post-edit', { session_id: SID_A, cwd: wt, tool_name: 'Edit', tool_input: { file_path: file } });
  git(wt, 'commit', '-q', '-am', 'c2');
  hook('session-end', { session_id: SID_A, cwd: wt, reason: 'other' });
  board = read(path.join(root, 'OWNERSHIP.md'));
  // clean tree but c, c2 are not on any remote ref: still orphaned-dirty. Simulate a push.
  assert.match(board, /\| src\/ \| aaaaaaaa \| orphaned-dirty \|.*0 uncommitted, 2 unpushed/);
  git(root, 'update-ref', 'refs/remotes/origin/feat/x', git(wt, 'rev-parse', 'HEAD'));
  hook('session-start', { session_id: SID_A, cwd: wt, source: 'resume' });
  hook('post-edit', { session_id: SID_A, cwd: wt, tool_name: 'Edit', tool_input: { file_path: file } });
  hook('session-end', { session_id: SID_A, cwd: wt, reason: 'other' });
  board = read(path.join(root, 'OWNERSHIP.md'));
  assert.match(board, /\| src\/ \| aaaaaaaa \| handoff-pending \|/);
  // decide, then end -> released
  hook('session-start', { session_id: SID_A, cwd: wt, source: 'resume' });
  const d = cli(wt, 'decide', 'src/', 'tiers are config', '--session', SID_A);
  assert.equal(d.code, 0, d.err);
  hook('session-end', { session_id: SID_A, cwd: wt, reason: 'other' });
  board = read(path.join(root, 'OWNERSHIP.md'));
  assert.match(board, /\| src\/ \| aaaaaaaa \| released \|/);
});

test('stop hook blocks a background session that owes a decision, nudges an interactive one', () => {
  const { root } = makeRepo({ worktree: false });
  initRepo(root);
  const file = path.join(root, 'src/pricing/tiers.js');
  hook('session-start', { session_id: SID_A, cwd: root, source: 'startup' }, { env: { WATCHKEEPER_BACKGROUND: '1' } });
  fs.appendFileSync(file, '// x\n');
  hook('post-edit', { session_id: SID_A, cwd: root, tool_name: 'Edit', tool_input: { file_path: file } });
  let r = hook('stop', { session_id: SID_A, cwd: root, stop_hook_active: false });
  assert.equal(r.json.decision, 'block');
  assert.match(r.json.reason, /watchkeeper:decide/);
  r = hook('stop', { session_id: SID_A, cwd: root, stop_hook_active: true });
  assert.ok(!r.json || r.json.decision !== 'block', 're-entry never blocks twice');
  // interactive
  hook('session-start', { session_id: SID_B, cwd: root, source: 'startup' }, { env: { WATCHKEEPER_BACKGROUND: '0' } });
  const f2 = path.join(root, 'db/views/rollup.sql');
  fs.appendFileSync(f2, '-- y\n');
  hook('post-edit', { session_id: SID_B, cwd: root, tool_name: 'Edit', tool_input: { file_path: f2 } });
  r = hook('stop', { session_id: SID_B, cwd: root, stop_hook_active: false });
  assert.ok(!r.json?.decision);
  assert.match(r.json.hookSpecificOutput.additionalContext, /decision entry/);
});
