// Classify the current change into a verification tier from paths and added content.
import { matchesAny } from './util.mjs';
import { baseBranch, changedFiles, diffText, diffHash, addedLinesByFile } from './git.mjs';

export function classifyFiles(config, files, addedByFile = {}) {
  const triggers = [];
  let tier = 0;
  const tiers = Object.keys(config.tiers || {}).map(Number).sort((a, b) => b - a);
  for (const f of files) {
    for (const t of tiers) {
      const spec = config.tiers[t] || {};
      if (matchesAny(f, spec.paths)) { triggers.push({ file: f, tier: t, reason: 'path' }); tier = Math.max(tier, t); break; }
      const added = addedByFile[f] || '';
      const hit = (spec.content || []).find((re) => { try { return new RegExp(re, 'i').test(added); } catch { return false; } });
      if (hit) { triggers.push({ file: f, tier: t, reason: `content: ${hit}` }); tier = Math.max(tier, t); break; }
    }
  }
  return { tier, triggers };
}

// committedOnly: what a push or PR would carry. Otherwise the working tree too.
export function classify(ctx, { committedOnly = false, cwd } = {}) {
  const wt = cwd || ctx.worktree;
  const base = baseBranch(wt, ctx.config);
  const { files, mergeBase } = changedFiles(wt, base, { committedOnly });
  const text = diffText(wt, base, { committedOnly });
  const added = addedLinesByFile(text);
  const { tier, triggers } = classifyFiles(ctx.config, files, added);
  return { tier, triggers, files, base, mergeBase, hash: diffHash(text), bytes: text.length };
}

export function describe(c) {
  if (!c.files.length) return 'no changes vs base';
  const t = c.triggers.slice(0, 6).map((x) => `${x.file} (${x.reason})`).join(', ');
  return `Tier ${c.tier}, ${c.files.length} file(s) vs ${c.base || 'HEAD'}${t ? `; triggers: ${t}` : ''}; diff ${c.hash}`;
}
