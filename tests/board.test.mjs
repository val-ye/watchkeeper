import test from 'node:test';
import assert from 'node:assert/strict';
import * as board from '../lib/board.mjs';
import { globToRegExp } from '../lib/util.mjs';

test('board round-trips through render and parse', () => {
  const b = board.emptyBoard();
  board.upsert(b, 'src/pricing/', { owner: 'aaaa1111', status: 'active', since: '2026-11-06 01:00', touched: '2026-11-06 02:00', branch: 'feat/x @ feature', note: 'has | pipe' });
  board.upsert(b, 'db/', { owner: 'bbbb2222', status: 'orphaned-dirty', since: '2026-11-05 23:00', touched: '2026-11-06 01:50', branch: 'feat/y', note: '3 uncommitted, 1 unpushed' });
  b.notes.push('human note kept');
  const text = board.render(b, { by: 'test' });
  const back = board.parse(text);
  assert.equal(back.rows.length, 2);
  assert.equal(back.rows[0].area, 'db/'); // orphaned-dirty sorts first
  assert.equal(back.rows[1].note, 'has / pipe');
  assert.deepEqual(back.notes, ['human note kept']);
  assert.match(text, /^Reconciled: \d{4}-\d{2}-\d{2} \d{2}:\d{2} by test$/m);
});

test('unparsable rows are preserved as notes, not dropped silently', () => {
  const text = board.render(board.emptyBoard(), { by: 't' }) + '| broken row |\n';
  const b = board.parse(text.replace(/\n\n## Notes[\s\S]*$/, '') );
  assert.ok(b.notes.some((n) => n.includes('unparsed row kept')));
});

test('glob helper', () => {
  assert.ok(globToRegExp('**/*.sql').test('db/views/a.sql'));
  assert.ok(globToRegExp('**/*.sql').test('a.sql'));
  assert.ok(globToRegExp('db/').test('db/views/a.sql'));
  assert.ok(!globToRegExp('db/').test('src/db/x'));
  assert.ok(globToRegExp('web/**').test('web/checkout/form.tsx'));
  assert.ok(globToRegExp('**/config/*.{json,yaml}').test('app/config/x.yaml'));
  assert.ok(!globToRegExp('**/config/*.{json,yaml}').test('app/config/x.ts'));
});
