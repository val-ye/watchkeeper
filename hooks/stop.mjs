import { hookMain } from './_common.mjs';
import * as board from '../lib/board.mjs';
import * as sessions from '../lib/sessions.mjs';
import { classify, describe } from '../lib/tiers.mjs';
import { shortId, stamp, minutesSince } from '../lib/util.mjs';

hookMain((ctx, input) => {
  const id = input.session_id || 'unknown';
  const me = shortId(id);
  const rec = sessions.touch(ctx, id, {});
  const owned = board.ownedBy(board.load(ctx), me);
  const notes = [];
  // Tier awareness: tell the agent once per tier change what its working tree amounts to.
  if (owned.length || (rec.edits || 0) > 0) {
    const c = classify(ctx, { committedOnly: false });
    if (c.files.length && c.tier !== rec.tier) {
      rec.tier = c.tier;
      if (c.tier === 2) notes.push(`[watchkeeper] Your change is ${describe(c)}. A verification record is required before push or PR: run /watchkeeper:verify when the diff is ready.`);
    }
  }
  // Handoff gate: a decision entry is owed when edits happened since the last one.
  const owed = owned.length > 0 && (rec.edits_since_decision || 0) > 0 && !input.stop_hook_active;
  const gate = ctx.config.stop_gate || 'auto';
  const applies = gate === 'always' || (gate === 'auto' && rec.background);
  const nudgeOk = minutesSince(rec.last_nudge_at) > (ctx.config.nudge_minutes ?? 30);
  sessions.save(ctx, rec);
  if (owed && applies) {
    rec.last_nudge_at = stamp(); sessions.save(ctx, rec);
    return { decision: 'block', reason: `[watchkeeper] Before stopping: you edited ${owned.map((r) => r.area).join(', ')} and have not written a decision entry. Run /watchkeeper:decide <area> "<what changed and why, one line>" --basis "<evidence>". Then, if your work on an area is finished, run /watchkeeper:release <area>. If you are keeping it, stop after the decision entry.` };
  }
  if (owed && nudgeOk) {
    rec.last_nudge_at = stamp(); sessions.save(ctx, rec);
    notes.push(`[watchkeeper] You own ${owned.map((r) => r.area).join(', ')} with ${rec.edits_since_decision} edit(s) since your last decision entry. When this unit of work is done: /watchkeeper:decide <area> "<one line>" then /watchkeeper:release <area>.`);
  }
  if (notes.length) return { hookSpecificOutput: { hookEventName: 'Stop', additionalContext: notes.join('\n') } };
  return null;
});
