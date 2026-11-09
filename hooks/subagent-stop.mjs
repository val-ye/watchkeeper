// Validate the verifier's record. Two labels, evidence on every verified claim, no confidence language.
import fs from 'node:fs';
import { hookMain, exit2 } from './_common.mjs';
import * as verifications from '../lib/verifications.mjs';
import * as assumptions from '../lib/assumptions.mjs';
import * as sessions from '../lib/sessions.mjs';
import { shortId } from '../lib/util.mjs';

hookMain((ctx, input) => {
  const pending = verifications.newestPending(ctx);
  if (!pending) return null;
  const hash = pending.data.hash;
  const p = verifications.recordPath(ctx, hash);
  const text = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
  const v = verifications.validate(text, { expectedHash: hash });
  if (!v.ok) {
    exit2(`[watchkeeper] Verification record ${p} is not acceptable:\n- ${v.problems.join('\n- ')}\nRules: every finding is "- verified: … Evidence: <command or file:line>" or "- unverified: … <why>". No percentages, no "likely", no "should be fine". Add a "## Verdict" with "status: verified" or "status: unverified-claims-present (n)". Fix the file and finish.`);
  }
  const branch = pending.data.branch || ctx.branch;
  const area = (pending.data.triggers?.[0]?.file || pending.data.files?.[0] || '-').split('/')[0];
  const already = assumptions.load(ctx).filter((a) => a.branch === branch && !a.closed).map((a) => a.claim);
  let added = 0;
  for (const c of v.claims.filter((x) => x.label === 'unverified')) {
    const body = c.text.replace(/\.?\s*Registered\.?\s*$/i, '').trim();
    const cut = body.search(/[.;:]\s+/);
    const claim = (cut > 0 ? body.slice(0, cut) : body).trim().slice(0, 160);
    const why = (cut > 0 ? body.slice(cut + 1).trim() : 'no reason given').slice(0, 120);
    if (already.includes(claim)) continue;
    assumptions.append(ctx, { branch, area, claim, why });
    added++;
  }
  verifications.clearPending(ctx, hash);
  const me = shortId(input.session_id);
  sessions.touch(ctx, input.session_id || 'unknown', { last_verification: hash });
  process.stdout.write(`[watchkeeper] Verification ${hash} accepted: ${v.claims.filter((x) => x.label === 'verified').length} verified, ${v.claims.filter((x) => x.label === 'unverified').length} unverified (${added} registered in ASSUMPTIONS.md). Session ${me}.\n`);
  return null;
});
