// Reconcile the board against session records and worktrees. Used by SessionStart, /manage and /handoff.
import fs from 'node:fs';
import * as board from './board.mjs';
import * as sessions from './sessions.mjs';
import { status as gitStatus, unpushed as gitUnpushed, worktrees } from './git.mjs';
import { stamp, minutesSince } from './util.mjs';

function worktreeState(wt) {
  if (!wt || !fs.existsSync(wt)) return { dirty: null, unpushed: null, missing: true };
  return { dirty: gitStatus(wt, 1200)?.total ?? null, unpushed: gitUnpushed(wt, 1200), missing: false };
}

// Apply the end-of-session rules to one session's rows. Returns the list of area changes.
export function settle(b, rec, state, { reason = '' } = {}) {
  const changes = [];
  const owned = board.ownedBy(b, rec.short);
  const dirty = (state.dirty || 0) > 0 || (state.unpushed || 0) > 0;
  const decided = !!rec.last_decision_at && (rec.edits_since_decision || 0) === 0;
  for (const r of owned) {
    let status; let note = r.note;
    if (dirty) { status = 'orphaned-dirty'; note = `${state.dirty ?? '?'} uncommitted, ${state.unpushed ?? '?'} unpushed${reason ? `; ${reason}` : ''}`; }
    else if (decided) { status = 'released'; note = `released by ${rec.short}${reason ? ` (${reason})` : ''}`; }
    else { status = 'handoff-pending'; note = `session ended without a decision entry${reason ? ` (${reason})` : ''}`; }
    if (r.status !== status) { changes.push({ area: r.area, from: r.status, to: status }); }
    Object.assign(r, { status, note, touched: r.touched || stamp() });
  }
  return changes;
}

export function reconcile(ctx, { by = 'reconcile', now = new Date() } = {}) {
  const running = sessions.runningSessionIds();
  const all = sessions.all(ctx);
  const report = { settled: [], duplicates: [], orphans: [], live: [] };
  board.update(ctx, (b) => {
    for (const rec of all) {
      const liveByHeartbeat = sessions.isLive(rec, ctx.config, now);
      const liveByCli = running ? running.has(rec.id) : null;
      const alive = !rec.ended && (liveByHeartbeat || liveByCli === true);
      if (alive) { report.live.push(rec); continue; }
      const state = worktreeState(rec.worktree);
      const changes = settle(b, rec, state, { reason: rec.ended ? `ended ${rec.ended_at || ''}`.trim() : `no heartbeat for ${Math.round(minutesSince(rec.heartbeat, now))} min` });
      report.settled.push(...changes.map((c) => ({ ...c, session: rec.short })));
      if (!rec.ended) { rec.ended = true; rec.ended_at = stamp(now); rec.end_reason = 'reconciled'; sessions.save(ctx, rec); }
    }
    // duplicates: two live sessions on one branch (not the base branch) or one area
    const byBranch = {};
    for (const rec of report.live) { if (rec.branch && rec.branch !== '-' && rec.branch !== 'HEAD') (byBranch[rec.branch] = byBranch[rec.branch] || []).push(rec.short); }
    for (const [branch, ids] of Object.entries(byBranch)) if (ids.length > 1) report.duplicates.push({ branch, sessions: ids });
    for (const d of report.duplicates) {
      for (const r of b.rows) if (d.sessions.includes(r.owner) && !/duplicate/.test(r.note)) r.note = `duplicate with ${d.sessions.filter((s) => s !== r.owner).join(',')} on ${d.branch}; ${r.note}`.slice(0, 80);
    }
    // orphaned worktrees: dirty or unpushed worktrees with no live session
    const liveWts = new Set(report.live.map((r) => r.worktree));
    b.orphans = [];
    for (const wt of worktrees(ctx.root)) {
      if (wt.bare || liveWts.has(wt.path)) continue;
      // The primary checkout is where humans work. It is an orphan only if a Claude session worked there and is gone.
      if (wt.path === ctx.root && !all.some((r) => r.worktree === ctx.root)) continue;
      const st = worktreeState(wt.path);
      if ((st.dirty || 0) > 0 || (st.unpushed || 0) > 0) {
        const owner = all.filter((r) => r.worktree === wt.path).sort((x, y) => (y.heartbeat || '').localeCompare(x.heartbeat || ''))[0];
        const o = { path: wt.path, branch: wt.branch || '-', dirty: st.dirty, unpushed: st.unpushed, owner: owner?.short || '-', seen: stamp(now) };
        b.orphans.push(o); report.orphans.push(o);
      }
    }
    b.sessions = report.live.map((r) => ({ short: r.short, role: r.role, worktreeName: r.worktreeName, branch: r.branch, heartbeat: r.heartbeat, background: r.background }));
    return true;
  }, { by, now });
  return report;
}
