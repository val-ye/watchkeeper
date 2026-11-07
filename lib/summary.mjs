// The morning takeover summary. Every number comes from a file or a git command, never from the model.
import * as board from './board.mjs';
import * as decisions from './decisions.mjs';
import * as assumptions from './assumptions.mjs';
import * as verifications from './verifications.mjs';
import * as authorization from './authorization.mjs';
import { reconcile } from './reconcile.mjs';
import { parseStamp, stamp } from './util.mjs';

function defaultSince(b, now) {
  const released = b.rows.filter((r) => r.status === 'released').map((r) => parseStamp(r.touched)).filter(Boolean).sort((a, c) => c - a)[0];
  const dayAgo = new Date(now.getTime() - 24 * 3600 * 1000);
  return released && released > dayAgo ? released : dayAgo;
}

export function build(ctx, { since, now = new Date(), reconcileFirst = true } = {}) {
  const rep = reconcileFirst ? reconcile(ctx, { by: 'handoff', now }) : null;
  const b = board.load(ctx);
  const sinceDate = since ? (parseStamp(since) || new Date(since)) : defaultSince(b, now);
  const dec = decisions.load(ctx);
  const superseded = decisions.supersededIds(dec.rows);
  const newDecisions = decisions.since(dec.rows, sinceDate).filter((r) => r.id !== 'OPEN');
  const open = decisions.openRows(dec.rows);
  const managerActions = newDecisions.filter((r) => /^manager/.test(r.by));
  const asm = assumptions.openFor(assumptions.load(ctx));
  const ver = verifications.list(ctx).filter((v) => v.mtime >= sinceDate);
  const auth = authorization.load(ctx);
  const authState = auth ? authorization.validate(auth, { now }) : null;
  const integrity = decisions.integrity(ctx);
  const touched = b.rows.filter((r) => parseStamp(r.touched) && parseStamp(r.touched) >= sinceDate);
  const orphans = rep ? rep.orphans : b.orphans;
  const pending = b.rows.filter((r) => r.status === 'handoff-pending');
  const live = b.sessions;

  const L = [];
  L.push(`# Handoff - ${ctx.root.split('/').pop()}`);
  L.push(`Since ${stamp(sinceDate)}, as of ${stamp(now)}. Board reconciled first.`);
  L.push('');
  L.push('## First');
  const first = [];
  for (const o of orphans) first.push(`Orphaned worktree ${o.path} on ${o.branch}: ${o.dirty ?? '?'} uncommitted, ${o.unpushed ?? '?'} unpushed, last owner ${o.owner}. Commit, push, or drop it.`);
  for (const r of pending) first.push(`${r.area}: ${r.owner} ended without a decision entry. Read its diff and write the entry yourself.`);
  for (const q of open) first.push(`Open question (${q.area}): ${q.decision}`);
  if (asm.length) first.push(`${asm.length} open assumption(s) block merging: ${asm.map((a) => `${a.id} ${a.branch}`).join(', ')}.`);
  if (!integrity.ok) first.push(`DECISIONS.md integrity: ${integrity.reason}.`);
  if (!first.length) first.push('Nothing left dirty, no open questions, no open assumptions.');
  first.slice(0, 6).forEach((f, i) => L.push(`${i + 1}. ${f}`));
  L.push('');
  L.push('## Board');
  if (!touched.length) L.push('No area touched in the window.');
  for (const r of touched) L.push(`- ${r.area}: ${r.status}, owner ${r.owner || '-'}, last ${r.touched}${r.branch ? `, ${r.branch}` : ''}${r.note ? `. ${r.note}` : ''}`);
  if (live.length) { L.push(''); L.push(`Live now: ${live.map((s) => `${s.short} (${s.role}${s.branch ? `, ${s.branch}` : ''})`).join('; ')}`); }
  L.push('');
  L.push('## Decisions');
  if (!newDecisions.length) L.push('None in the window.');
  for (const d of newDecisions) L.push(`- ${d.id} ${d.date} ${d.area}: ${d.decision}${d.basis ? ` (${d.basis})` : ''}${d.supersedes && d.supersedes !== '-' ? `, supersedes ${d.supersedes}` : ''}${superseded.has(d.id) ? ' [superseded]' : ''}`);
  L.push('');
  L.push('## Manager');
  if (!auth) L.push('No AUTHORIZATION.md: manager was read-only.');
  else L.push(`AUTHORIZATION.md ${auth.hash}: ${authState.ok ? 'active' : 'inactive'}${authState.ok ? '' : ` (${authState.reasons.join('; ')})`}, expires ${auth.expires_at}, branches ${(auth.target_branches || []).join(', ')}.`);
  if (managerActions.length) for (const m of managerActions) L.push(`- ${m.date}: ${m.decision} (${m.basis})`);
  else L.push('No manager actions in the window.');
  L.push('');
  L.push('## Verification');
  if (!ver.length) L.push('No verification records in the window.');
  for (const v of ver) L.push(`- ${v.hash} ${v.meta.branch || ''} tier ${v.meta.tier || '?'}: ${v.claims.filter((c) => c.label === 'verified').length} verified, ${v.claims.filter((c) => c.label === 'unverified').length} unverified. ${v.status}`);
  for (const a of asm) L.push(`- open ${a.id} (${a.branch}, ${a.area}): ${a.claim}. ${a.why}`);
  if (rep && rep.duplicates.length) { L.push(''); L.push('## Duplicates'); for (const d of rep.duplicates) L.push(`- ${d.branch}: sessions ${d.sessions.join(', ')}`); }
  return L.join('\n') + '\n';
}
