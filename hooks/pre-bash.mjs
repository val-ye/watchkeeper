// Gates on git push / gh pr create (verification) and gh pr merge (assumptions + manager mandate).
import { hookMain, deny, allowWithContext } from './_common.mjs';
import * as sessions from '../lib/sessions.mjs';
import * as assumptions from '../lib/assumptions.mjs';
import * as verifications from '../lib/verifications.mjs';
import * as authorization from '../lib/authorization.mjs';
import * as decisions from '../lib/decisions.mjs';
import { classify, describe } from '../lib/tiers.mjs';
import { run } from '../lib/util.mjs';

const PUSH = /(^|[;&|]\s*)git\s+(?:[-\w=]+\s+)*push\b/;
const PR_CREATE = /(^|[;&|]\s*)gh\s+pr\s+create\b/;
const PR_MERGE = /(^|[;&|]\s*)gh\s+pr\s+merge\b(?:\s+(\d+|https?:\S+))?/;

function prInfo(cwd, ref) {
  const args = ['pr', 'view'];
  if (ref) args.push(ref);
  args.push('--json', 'number,headRefName,baseRefName,commits,statusCheckRollup,mergeable');
  const r = run(process.env.WATCHKEEPER_GH_BIN || 'gh', args, { cwd, timeout: 15000 });
  if (!r.ok) return null;
  try { return JSON.parse(r.out); } catch { return null; }
}

hookMain((ctx, input) => {
  const cmd = String(input.tool_input?.command || '');
  if (!cmd) return null;
  const rec = sessions.touch(ctx, input.session_id || 'unknown', {});
  const cwd = input.cwd || ctx.cwd;

  if (PUSH.test(cmd) || PR_CREATE.test(cmd)) {
    if (/--delete\b|\s-d\b|--dry-run/.test(cmd)) return null;
    const c = classify(ctx, { committedOnly: true, cwd });
    if (!c.files.length) return null;
    if (c.tier === 2) {
      const rec2 = verifications.find(ctx, c.hash);
      if (!rec2) {
        return deny(`[watchkeeper] Tier 2 change needs a verification record before it goes out for review. ${describe(c)}. Run /watchkeeper:verify (it writes .watchkeeper/verifications/${c.hash}.md). If the diff changed after the last verification, verify again.`);
      }
      const unver = rec2.claims.filter((x) => x.label === 'unverified').length;
      return allowWithContext(`[watchkeeper] Verification record ${c.hash} found: ${rec2.claims.length - unver} verified, ${unver} unverified${unver ? ' (registered in ASSUMPTIONS.md; the PR will not merge until they close)' : ''}.`);
    }
    if (c.tier === 1) return allowWithContext(`[watchkeeper] Tier 1 change (${c.files.length} files, docs or copy). Before pushing: no invented numbers, no claims about behaviour you did not run, hyphens not em dashes.`);
    return null;
  }

  const m = cmd.match(PR_MERGE);
  if (m) {
    const pr = prInfo(cwd, m[2]);
    const branch = pr?.headRefName || ctx.branch;
    const open = assumptions.openFor(assumptions.load(ctx), branch);
    if (open.length) return deny(`[watchkeeper] ${open.length} open assumption(s) on ${branch} block the merge: ${open.map((a) => `${a.id} ${a.claim}`).join('; ')}. Close them with a verification record or a human decision (/watchkeeper:decide … then close the row).`);
    if (rec.role === 'manager') {
      const auth = authorization.load(ctx);
      const authors = (pr?.commits || []).flatMap((x) => (x.authors || []).map((a) => a.login || a.email || a.name)).filter(Boolean);
      const dec = decisions.load(ctx);
      const mergesSoFar = auth ? dec.rows.filter((r) => /^manager/.test(r.by) && r.basis.includes(auth.hash) && /merged/i.test(r.decision)).length : 0;
      const v = authorization.validate(auth, { action: 'merge', targetBranch: pr?.baseRefName, authors, mergesSoFar });
      if (!pr) return deny('[watchkeeper] Manager merge refused: could not read the PR with gh (not authenticated, or no PR for this branch). The manager fails closed.');
      if (!v.ok) return deny(`[watchkeeper] Manager merge refused by AUTHORIZATION.md: ${v.reasons.join('; ')}.`);
      const failing = (pr.statusCheckRollup || []).filter((s) => ['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED'].includes(s.conclusion || s.state));
      const pendingChecks = (pr.statusCheckRollup || []).filter((s) => !s.conclusion && ['PENDING', 'IN_PROGRESS', 'QUEUED', 'EXPECTED'].includes(s.status || s.state));
      if (failing.length || pendingChecks.length) return deny(`[watchkeeper] Manager merge refused: ${failing.length} failing, ${pendingChecks.length} pending check(s) on PR #${pr.number}.`);
      return allowWithContext(`[watchkeeper] Manager merge of PR #${pr.number} into ${pr.baseRefName} allowed by AUTHORIZATION.md ${auth.hash} (${mergesSoFar + 1}/${auth.max_merges ?? '∞'}). After it lands, record it: /watchkeeper:decide <area> "manager merged PR #${pr.number} into ${pr.baseRefName}" --basis "AUTHORIZATION.md ${auth.hash}; checks green; assumptions empty".`);
    }
    return null;
  }
  return null;
});
