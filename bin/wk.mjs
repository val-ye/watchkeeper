#!/usr/bin/env node
// watchkeeper CLI. Skills call this; humans can too. Every number printed comes from a file or git.
import path from 'node:path';
import fs from 'node:fs';
import { resolveContext } from '../lib/paths.mjs';
import * as board from '../lib/board.mjs';
import * as decisions from '../lib/decisions.mjs';
import * as sessions from '../lib/sessions.mjs';
import * as assumptions from '../lib/assumptions.mjs';
import * as verifications from '../lib/verifications.mjs';
import * as authorization from '../lib/authorization.mjs';
import { classify, describe } from '../lib/tiers.mjs';
import { reconcile } from '../lib/reconcile.mjs';
import { build as buildSummary } from '../lib/summary.mjs';
import { init } from '../lib/init.mjs';
import { stamp, shortId, readText, writeAtomic } from '../lib/util.mjs';

const argv = process.argv.slice(2);
const cmd = argv.shift();
const flags = {}; const pos = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) { const k = a.slice(2); const v = argv[i + 1]; if (v != null && !v.startsWith('--')) { flags[k] = v; i++; } else flags[k] = true; }
  else pos.push(a);
}

function die(msg, code = 1) { process.stderr.write(`watchkeeper: ${msg}\n`); process.exit(code); }
const ctx = resolveContext(flags.cwd || process.cwd());
if (!ctx) die('not inside a git repository');
if (flags.base) ctx.config.base_branch = flags.base;
let _sid = null;
function sessionId() {
  if (_sid) return _sid;
  _sid = flags.session || process.env.WATCHKEEPER_SESSION || process.env.CLAUDE_SESSION_ID || (ctx.initialized ? sessions.sessionFromPid(ctx) : null) || `cli-${process.ppid}`;
  return _sid;
}
if (cmd !== 'init' && !ctx.initialized) die(`this repository is not initialized. Run: /watchkeeper:init  (or: node ${path.relative(process.cwd(), process.argv[1])} init)`);

const me = shortId(sessionId());
const branchLabel = () => (ctx.worktreeName !== '-' ? `${ctx.branch} @ ${ctx.worktreeName}` : ctx.branch);

switch (cmd) {
  case 'init': {
    const r = init(ctx, { local: !!flags.local, mode: flags.mode || 'deny', areas: flags.areas ? String(flags.areas).split(',') : [], base: flags.base || null });
    console.log(`Initialized watchkeeper in ${ctx.root}${r.local ? ' (local mode: nothing will show in git status)' : ''}.`);
    for (const c of r.created) console.log(`  created ${path.relative(ctx.root, c)}`);
    if (r.excluded.length) console.log(`  excluded via .git/info/exclude: ${r.excluded.join(', ')}`);
    console.log('Next: edit .watchkeeper/config.json (areas, base_branch) and .watchkeeper/VERIFY.md. New sessions in this repo now read the board on start.');
    break;
  }
  case 'status': case 'board': {
    if (flags.reconcile !== false) reconcile(ctx, { by: `status ${me}` });
    process.stdout.write(readText(ctx.files.ownership, '(no board)\n'));
    break;
  }
  case 'claim': {
    const area = pos[0]; if (!area) die('usage: claim <area> [--note "…"] [--takeover]');
    const now = stamp();
    const res = board.update(ctx, (b) => {
      const row = board.find(b, area);
      if (row && row.owner && row.owner !== me && ['active', 'idle'].includes(row.status)) {
        const owner = sessions.all(ctx).find((s) => s.short === row.owner);
        if (owner && sessions.isLive(owner, ctx.config) && !flags.takeover) return { refused: `owned by live session ${row.owner}; add --takeover to take it anyway (recorded)` };
      }
      const takeover = row && row.owner && row.owner !== me;
      board.upsert(b, area, { owner: me, status: 'active', since: now, touched: now, branch: branchLabel(), note: flags.note || (takeover ? `taken over from ${row.owner}` : 'claimed') });
      return { takeover: takeover ? row.owner : null };
    }, { by: me });
    if (res.refused) die(res.refused, 2);
    sessions.touch(ctx, sessionId(), {});
    if (res.takeover) decisions.append(ctx, { area, decision: `Ownership of ${area} taken over from ${res.takeover}`, basis: flags.note || 'explicit --takeover', by: me });
    console.log(`${me} now owns ${area}${res.takeover ? ` (taken over from ${res.takeover}, recorded in DECISIONS.md)` : ''}.`);
    break;
  }
  case 'release': {
    const areas = pos.length ? pos : board.ownedBy(board.load(ctx), me).map((r) => r.area);
    if (!areas.length) die('you own no areas');
    const rec = sessions.load(ctx, sessionId());
    if (rec && (rec.edits_since_decision || 0) > 0 && !flags.force) die(`${rec.edits_since_decision} edit(s) since your last decision entry. Run decide first, or --force.`, 2);
    board.update(ctx, (b) => { for (const a of areas) { const r = board.find(b, a); if (r && r.owner === me) Object.assign(r, { status: 'released', touched: stamp(), note: flags.note || `released by ${me}` }); } return true; }, { by: me });
    console.log(`released: ${areas.join(', ')}`);
    break;
  }
  case 'decide': {
    const area = pos[0]; const text = pos.slice(1).join(' ');
    if (!area || !text) die('usage: decide <area> "<decision, one line>" [--basis "…"] [--supersedes d-0001] [--open]');
    const id = decisions.append(ctx, { area, decision: text, basis: flags.basis || '', by: flags.by || me, supersedes: flags.supersedes || '', open: !!flags.open });
    const rec = sessions.load(ctx, sessionId()) || sessions.start(ctx, sessionId());
    if (!flags.open) { rec.last_decision_at = stamp(); rec.edits_since_decision = 0; sessions.save(ctx, rec); }
    console.log(`${id} appended to DECISIONS.md`);
    break;
  }
  case 'open': { // shorthand for an OPEN question
    const area = pos[0]; const text = pos.slice(1).join(' ');
    if (!area || !text) die('usage: open <area> "<question>"');
    decisions.append(ctx, { area, decision: `${text} Raised ${stamp().slice(5, 10)}.`, basis: flags.basis || '', by: me, open: true });
    console.log('OPEN row appended');
    break;
  }
  case 'reconcile': {
    const r = reconcile(ctx, { by: flags.by || `reconcile ${me}` });
    console.log(JSON.stringify({ live: r.live.map((s) => s.short), settled: r.settled, duplicates: r.duplicates, orphans: r.orphans.map((o) => ({ path: o.path, branch: o.branch, dirty: o.dirty, unpushed: o.unpushed })) }, null, 2));
    break;
  }
  case 'summary': case 'handoff': {
    const text = buildSummary(ctx, { since: flags.since });
    if (flags.write) { writeAtomic(flags.write, text); console.log(`written ${flags.write}`); } else process.stdout.write(text);
    break;
  }
  case 'tier': {
    const c = classify(ctx, { committedOnly: !!flags.committed });
    console.log(describe(c));
    if (flags.json) console.log(JSON.stringify(c, null, 2));
    break;
  }
  case 'verify-prepare': {
    const c = classify(ctx, { committedOnly: !!flags.committed });
    if (!c.files.length) { console.log('NO_CHANGES'); break; }
    const p = verifications.writePending(ctx, c, { branch: ctx.branch, session: me });
    const existing = verifications.find(ctx, c.hash);
    const instr = readText(ctx.files.verify, '');
    console.log(`DIFF_HASH: ${c.hash}`);
    console.log(`TIER: ${c.tier}`);
    console.log(`BASE: ${c.base || '-'}  MERGE_BASE: ${c.mergeBase || '-'}  BRANCH: ${ctx.branch}`);
    console.log(`FILES (${c.files.length}): ${c.files.join(', ')}`);
    console.log(`TRIGGERS: ${c.triggers.map((t) => `${t.file} (${t.reason})`).join('; ') || '-'}`);
    console.log(`RECORD_PATH: ${verifications.recordPath(ctx, c.hash)}`);
    console.log(`PENDING: ${p}`);
    console.log(`EXISTING_RECORD: ${existing ? 'yes (re-verify overwrites it)' : 'no'}`);
    console.log('\n--- .watchkeeper/VERIFY.md ---'); console.log(instr || '(empty)');
    console.log('\n--- record template ---'); console.log(verifications.templateFor({ ...c, branch: ctx.branch }, instr));
    break;
  }
  case 'verify-check': {
    const hash = pos[0] || verifications.newestPending(ctx)?.data.hash; if (!hash) die('no hash');
    const text = readText(verifications.recordPath(ctx, hash), '');
    const v = verifications.validate(text, { expectedHash: hash });
    console.log(v.ok ? `OK ${hash}: ${v.claims.length} claims` : `PROBLEMS:\n- ${v.problems.join('\n- ')}`);
    process.exit(v.ok ? 0 : 2);
  }
  case 'close-assumption': {
    const id = pos[0]; const by = pos[1]; if (!id || !by) die('usage: close-assumption a-001 d-0042');
    assumptions.close(ctx, id, by); console.log(`${id} closed by ${by}`); break;
  }
  case 'assumptions': {
    const rows = assumptions.openFor(assumptions.load(ctx), flags.branch || null);
    console.log(rows.length ? rows.map((r) => `${r.id} ${r.branch} ${r.area}: ${r.claim} (${r.why})`).join('\n') : 'none open');
    break;
  }
  case 'role': {
    const role = pos[0]; if (!['manager', 'worker'].includes(role)) die('usage: role manager|worker');
    sessions.touch(ctx, sessionId(), { role }); console.log(`session ${me} role = ${role}`); break;
  }
  case 'authorize': {
    if (fs.existsSync(ctx.files.authorization) && !flags.force) die('AUTHORIZATION.md exists; use --force to overwrite or revoke first');
    if (!flags.by || !flags.until) die('usage: authorize --by "<name>" --until "YYYY-MM-DD HH:mm" [--branches develop] [--authors a,b] [--max 5]');
    writeAtomic(ctx.files.authorization, authorization.template({ grantedBy: flags.by, expiresAt: flags.until, branches: flags.branches || 'develop', authors: flags.authors || '', maxMerges: flags.max || 5 }));
    const a = authorization.load(ctx);
    decisions.append(ctx, { area: 'manager', decision: `Manager mandate granted until ${flags.until} for ${flags.branches || 'develop'}`, basis: `AUTHORIZATION.md ${a.hash}`, by: flags.by });
    console.log(`AUTHORIZATION.md written (${a.hash}). Revoke: delete it or add revoked_at.`);
    break;
  }
  case 'revoke': {
    const t = readText(ctx.files.authorization, null); if (t == null) die('no AUTHORIZATION.md');
    writeAtomic(ctx.files.authorization, t.replace(/\n?$/, '\n') + `revoked_at: ${stamp()}\n`);
    decisions.append(ctx, { area: 'manager', decision: 'Manager mandate revoked', basis: 'revoke command', by: me });
    console.log('revoked'); break;
  }
  case 'authorization': {
    const a = authorization.load(ctx); if (!a) { console.log('absent: manager is read-only'); break; }
    const v = authorization.validate(a, { action: 'merge' }); console.log(`${a.hash} ${v.ok ? 'ACTIVE' : 'INACTIVE'} ${v.reasons.join('; ')}`); break;
  }
  case 'whoami': console.log(`${me} role=${sessions.load(ctx, sessionId())?.role || 'worker'} root=${ctx.root} worktree=${ctx.worktree} branch=${ctx.branch}`); break;
  default:
    console.log(`watchkeeper <command>
  init [--local] [--mode deny|warn] [--areas a/,b/] [--base develop]
  status | board            reconcile and print OWNERSHIP.md
  claim <area> [--takeover] [--note "…"]
  release [area…] [--force]
  decide <area> "<text>" [--basis "…"] [--supersedes d-0001]
  open <area> "<question>"  append an OPEN row
  reconcile                 settle dead sessions, find orphans and duplicates
  summary | handoff [--since "YYYY-MM-DD HH:mm"] [--write path]
  tier [--committed]        classify the current change
  verify-prepare [--committed] | verify-check [hash]
  assumptions [--branch b] | close-assumption <a-id> <d-id|v-hash>
  role manager|worker | authorize --by … --until … | revoke | authorization
  whoami`);
}
