// AUTHORIZATION.md: the manager's written, revocable mandate. Absent file = read-only manager.
import { readText, parseStamp, sha256, globToRegExp } from './util.mjs';

const LIST_KEYS = new Set(['target_branches', 'actions', 'authors', 'never', 'repos']);

export function parse(text) {
  if (!text) return null;
  const a = { raw: text, hash: sha256(text).slice(0, 12) };
  for (const line of text.split('\n')) {
    const m = line.match(/^([a-z_]+):\s*(.*)$/);
    if (!m) continue;
    const [, k, v] = m;
    a[k] = LIST_KEYS.has(k) ? v.split(',').map((s) => s.trim()).filter(Boolean) : v.trim();
  }
  if (a.max_merges != null) a.max_merges = parseInt(a.max_merges, 10);
  return a;
}

export function load(ctx) { return parse(readText(ctx.files.authorization, null)); }

// Can the manager perform `action` on `targetBranch` with these commit authors right now?
export function validate(a, { now = new Date(), action = 'merge', targetBranch, authors = [], mergesSoFar = 0 } = {}) {
  const reasons = [];
  if (!a) return { ok: false, reasons: ['AUTHORIZATION.md is absent: the manager may only read and reconcile'] };
  if (a.revoked_at) reasons.push(`revoked at ${a.revoked_at}`);
  const exp = parseStamp(a.expires_at);
  if (!exp) reasons.push('expires_at missing or unparseable');
  else if (exp <= now) reasons.push(`expired at ${a.expires_at}`);
  if (!a.granted_by) reasons.push('granted_by missing');
  if (!(a.actions || []).includes(action)) reasons.push(`action "${action}" not granted (granted: ${(a.actions || []).join(', ') || 'none'})`);
  if (targetBranch) {
    if ((a.never || []).some((g) => globToRegExp(g).test(targetBranch))) reasons.push(`target branch ${targetBranch} is in never`);
    if (!(a.target_branches || []).some((g) => globToRegExp(g).test(targetBranch))) reasons.push(`target branch ${targetBranch} not in target_branches`);
  }
  if (a.authors && a.authors.length && authors.length) {
    const bad = authors.filter((x) => !a.authors.some((ok) => x.toLowerCase() === ok.toLowerCase()));
    if (bad.length) reasons.push(`commit author(s) not in authors: ${[...new Set(bad)].join(', ')}`);
  }
  if (Number.isFinite(a.max_merges) && mergesSoFar >= a.max_merges) reasons.push(`max_merges ${a.max_merges} reached (${mergesSoFar} done)`);
  return { ok: reasons.length === 0, reasons };
}

export function template({ grantedBy, expiresAt, branches = 'develop', authors = '', maxMerges = 5 }) {
  return `# AUTHORIZATION - manager mandate

granted_by: ${grantedBy}
granted_at: ${new Date().toISOString().slice(0, 16).replace('T', ' ')}
expires_at: ${expiresAt}
target_branches: ${branches}
actions: merge, comment, close-stale
authors: ${authors}
require: all checks green; ASSUMPTIONS.md empty for the PR; Tier 2 diffs have a verification record
never: main, master, release/*, force-push, rebase, config changes
max_merges: ${maxMerges}

Revoke: delete this file, or add a line "revoked_at: <YYYY-MM-DD HH:mm>".
Every merge made under this file is recorded in DECISIONS.md with the file hash.
`;
}
