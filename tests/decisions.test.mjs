import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeRepo, initRepo, cli, read } from './helpers.mjs';
import { resolveContext } from '../lib/paths.mjs';
import * as decisions from '../lib/decisions.mjs';

test('decisions append only, ids sequential, supersedes validated, in-place edits detected', () => {
  const { root } = makeRepo({ worktree: false });
  initRepo(root);
  const ctx = resolveContext(root);
  const id1 = decisions.append(ctx, { area: 'src/', decision: 'first', basis: 'b', by: 'x' });
  const id2 = decisions.append(ctx, { area: 'src/', decision: 'second', basis: 'b', by: 'x', supersedes: id1 });
  assert.equal(id1, 'd-0001'); assert.equal(id2, 'd-0002');
  assert.throws(() => decisions.append(ctx, { area: 'a', decision: 'x', supersedes: 'd-0099' }), /no such decision/);
  decisions.append(ctx, { area: 'db/', decision: 'grain: user or household? Raised 11-06.', by: 'x', open: true });
  const { rows } = decisions.load(ctx);
  assert.equal(rows.length, 3);
  assert.deepEqual([...decisions.supersededIds(rows)], ['d-0001']);
  assert.equal(decisions.openRows(rows).length, 1);
  assert.equal(decisions.integrity(ctx).ok, true);
  // tamper with an earlier row
  const p = ctx.files.decisions;
  fs.writeFileSync(p, read(p).replace('| first |', '| FIRST edited |'));
  assert.equal(decisions.integrity(ctx).ok, false);
  // CLI path
  const r = cli(root, 'decide', 'web/', 'checkout keeps the old form', '--basis', 'human', '--session', 'cccccccc-0000');
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /d-0003 appended/);
});

test('decide via CLI refuses without text', () => {
  const { root } = makeRepo({ worktree: false });
  initRepo(root);
  const r = cli(root, 'decide', 'web/');
  assert.notEqual(r.code, 0);
});
