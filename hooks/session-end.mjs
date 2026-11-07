// 1.5 s budget by default. Fast bookkeeping only: release or orphan this session's rows.
import { hookMain } from './_common.mjs';
import * as sessions from '../lib/sessions.mjs';
import * as board from '../lib/board.mjs';
import { settle } from '../lib/reconcile.mjs';
import { status as gitStatus, unpushed as gitUnpushed } from '../lib/git.mjs';

hookMain((ctx, input) => {
  const id = input.session_id || 'unknown';
  const rec = sessions.end(ctx, id, input.reason || '');
  if (!rec) return null;
  if (input.reason === 'resume' || input.reason === 'clear') return null; // the session continues under the same id
  const st = gitStatus(rec.worktree || ctx.worktree, 400);
  const up = gitUnpushed(rec.worktree || ctx.worktree, 400);
  board.update(ctx, (b) => { settle(b, rec, { dirty: st?.total ?? null, unpushed: up }, { reason: `ended ${input.reason || ''}`.trim() }); return true; }, { by: rec.short });
  return null;
});
