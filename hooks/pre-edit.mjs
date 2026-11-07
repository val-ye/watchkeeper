import { hookMain, deny, allowWithContext } from './_common.mjs';
import * as board from '../lib/board.mjs';
import * as sessions from '../lib/sessions.mjs';
import { relPath, areaFor } from '../lib/paths.mjs';
import { shortId } from '../lib/util.mjs';

hookMain((ctx, input) => {
  const file = input.tool_input?.file_path || input.tool_input?.notebook_path;
  const rel = relPath(ctx, file);
  if (!rel) return null;
  if (/^(OWNERSHIP\.md|DECISIONS\.md|\.watchkeeper\/(ASSUMPTIONS\.md|verifications\/|local\/))/.test(rel)) {
    if (rel === 'DECISIONS.md') return deny('DECISIONS.md is append-only and written by /watchkeeper:decide. Never edit it directly.');
    if (rel === 'OWNERSHIP.md') return allowWithContext('OWNERSHIP.md is maintained by hooks. Prefer /watchkeeper:claim and /watchkeeper:release; manual edits are kept if they follow the table grammar.');
  }
  const area = areaFor(ctx, rel);
  const me = shortId(input.session_id);
  const b = board.load(ctx);
  const row = board.find(b, area);
  if (!row || !row.owner || row.owner === me || ['released', 'orphaned-clean'].includes(row.status)) return null;
  const owner = sessions.all(ctx).find((s) => s.short === row.owner);
  const live = owner && sessions.isLive(owner, ctx.config);
  const mode = ctx.config.ownership?.mode || 'deny';
  const msg = `${area} is owned by session ${row.owner} (${row.status}, since ${row.since || '?'}, last touched ${row.touched || '?'}${row.branch ? `, ${row.branch}` : ''}).`;
  if (live && mode === 'deny') {
    return deny(`${msg} It is alive. Do not edit this area. Message that session, or take it over on purpose: /watchkeeper:claim ${area} --takeover (recorded in DECISIONS.md).`);
  }
  if (live) return allowWithContext(`${msg} It is alive. Coordinate before changing shared files.`);
  return allowWithContext(`${msg} That session is not alive (${row.status}). Editing will claim the area for you; check its worktree for uncommitted work first.`);
});
