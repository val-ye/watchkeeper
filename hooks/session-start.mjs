import { hookMain } from './_common.mjs';
import * as sessions from '../lib/sessions.mjs';
import * as board from '../lib/board.mjs';
import * as decisions from '../lib/decisions.mjs';
import * as assumptions from '../lib/assumptions.mjs';
import * as authorization from '../lib/authorization.mjs';
import { reconcile } from '../lib/reconcile.mjs';
import { readText } from '../lib/util.mjs';
import fs from 'node:fs';

hookMain((ctx, input) => {
  const id = input.session_id || 'unknown';
  const source = input.source || 'startup';
  const bg = source === 'compact' ? {} : sessions.detectBackground(id);
  sessions.start(ctx, id, bg.background != null ? { background: bg.background, name: bg.name || '' } : {});
  sessions.recordPid(ctx, process.ppid, id);
  if (process.env.CLAUDE_ENV_FILE) {
    try { fs.appendFileSync(process.env.CLAUDE_ENV_FILE, `export WATCHKEEPER_ROOT="${ctx.root}"\nexport WATCHKEEPER_SESSION="${id}"\n`); } catch { /* ignore */ }
  }
  if (source !== 'compact') reconcile(ctx, { by: `start ${sessions.load(ctx, id).short}` });
  const b = board.load(ctx);
  const me = sessions.load(ctx, id).short;
  const L = [];
  L.push(`[watchkeeper] Board for ${ctx.root}. You are session ${me}${ctx.worktreeName !== '-' ? ` in worktree ${ctx.worktreeName}` : ''} on ${ctx.branch}.`);
  L.push('Protocol: edit and the area is claimed for you; areas owned by a live session are off limits (ask them, or /watchkeeper:claim <area> --takeover); write one DECISIONS entry (/watchkeeper:decide) before you release or finish; never edit DECISIONS.md by hand; Tier 2 changes need /watchkeeper:verify before push.');
  const rows = b.rows.filter((r) => r.status !== 'released' || r.touched >= '');
  if (rows.length) {
    L.push('', 'OWNERSHIP (area | owner | status | last touched | branch | note):');
    for (const r of rows.slice(0, 40)) {
      const live = b.sessions.some((s) => s.short === r.owner);
      const tag = r.owner === me ? ' (you)' : live && ['active', 'idle'].includes(r.status) ? ' OFF LIMITS' : '';
      L.push(`- ${r.area} | ${r.owner || '-'}${tag} | ${r.status} | ${r.touched || '-'} | ${r.branch || '-'} | ${r.note || ''}`);
    }
  } else L.push('', 'OWNERSHIP: no areas claimed.');
  if (b.orphans.length) { L.push('', 'ORPHANED WORKTREES:'); for (const o of b.orphans) L.push(`- ${o.path} (${o.branch}): ${o.dirty} uncommitted, ${o.unpushed} unpushed, last owner ${o.owner}`); }
  if (source !== 'compact') {
    const dec = decisions.load(ctx);
    const sup = decisions.supersededIds(dec.rows);
    const recent = decisions.recent(dec.rows, ctx.config.decisions_on_start || 10);
    if (recent.length) { L.push('', `DECISIONS (last ${recent.length}; superseded ones marked):`); for (const d of recent) L.push(`- ${d.id} ${d.date} ${d.area}: ${d.decision}${d.supersedes && d.supersedes !== '-' ? ` [supersedes ${d.supersedes}]` : ''}${sup.has(d.id) ? ' [SUPERSEDED]' : ''}`); }
    const open = decisions.openRows(dec.rows);
    if (open.length) { L.push('', 'OPEN QUESTIONS (do not re-derive; wait for a human or add a dated row):'); for (const q of open) L.push(`- ${q.area}: ${q.decision}`); }
    const asm = assumptions.openFor(assumptions.load(ctx), ctx.branch);
    if (asm.length) { L.push('', `OPEN ASSUMPTIONS on ${ctx.branch} (block merge):`); for (const a of asm) L.push(`- ${a.id} ${a.area}: ${a.claim}`); }
    const auth = authorization.load(ctx);
    if (auth) { const v = authorization.validate(auth); L.push('', `MANAGER MANDATE: ${v.ok ? 'active' : 'inactive'} (${auth.hash}, expires ${auth.expires_at}, branches ${(auth.target_branches || []).join(', ')})`); }
    const integ = decisions.integrity(ctx);
    if (!integ.ok) L.push('', `WARNING: DECISIONS.md was edited in place: ${integ.reason}`);
  }
  let text = L.join('\n');
  if (text.length > 9500) text = text.slice(0, 9400) + '\n… (truncated; read OWNERSHIP.md and DECISIONS.md directly)';
  return text + '\n';
});
