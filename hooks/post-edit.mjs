import { hookMain } from './_common.mjs';
import * as board from '../lib/board.mjs';
import * as sessions from '../lib/sessions.mjs';
import { relPath, areaFor } from '../lib/paths.mjs';
import { shortId, stamp } from '../lib/util.mjs';

hookMain((ctx, input) => {
  const file = input.tool_input?.file_path || input.tool_input?.notebook_path;
  const rel = relPath(ctx, file);
  if (!rel || /^(OWNERSHIP\.md|DECISIONS\.md|AUTHORIZATION\.md|\.watchkeeper\/)/.test(rel)) return null;
  const area = areaFor(ctx, rel);
  const id = input.session_id || 'unknown';
  const me = shortId(id);
  const rec = sessions.touch(ctx, id, {});
  rec.edits = (rec.edits || 0) + 1; rec.edits_since_decision = (rec.edits_since_decision || 0) + 1; rec.last_edit_at = stamp();
  sessions.save(ctx, rec);
  board.update(ctx, (b) => {
    const row = board.find(b, area);
    const now = stamp();
    const branch = ctx.worktreeName !== '-' ? `${ctx.branch} @ ${ctx.worktreeName}` : ctx.branch;
    if (!row || !row.owner || ['released', 'orphaned-clean', 'orphaned-dirty', 'handoff-pending'].includes(row.status) || row.owner === me) {
      const takeover = row && row.owner && row.owner !== me;
      board.upsert(b, area, {
        owner: me, status: 'active', since: row && row.owner === me && row.since ? row.since : now, touched: now, branch,
        note: takeover ? `taken over from ${row.owner} (${row.status}) on first edit` : (row && row.owner === me ? row.note : 'auto-claimed on first edit'),
      });
      return true;
    }
    // owned by someone else and we got here (warn mode or stale): claim anyway, record it in the note
    board.upsert(b, area, { owner: me, status: 'active', since: now, touched: now, branch, note: `taken over from ${row.owner} (was ${row.status}) on edit` });
    return true;
  }, { by: me });
  return null;
});
