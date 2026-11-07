// Verification records: one file per diff hash, written by the verifier subagent, validated by the SubagentStop hook.
import fs from 'node:fs';
import path from 'node:path';
import { readText, writeJson, readJson, stamp, ensureDir } from './util.mjs';

export function recordPath(ctx, hash) { return path.join(ctx.files.verifications, `${hash}.md`); }
export function pendingPath(ctx, hash) { return path.join(ctx.files.verifications, `${hash}.pending.json`); }

export function parse(text) {
  const meta = {};
  const claims = [];
  let status = '';
  for (const line of (text || '').split('\n')) {
    const m = line.match(/^([a-z_]+):\s*(.*)$/);
    if (m && !line.startsWith('- ')) { if (m[1] === 'status') status = m[2].trim(); else meta[m[1]] = m[2].trim(); continue; }
    const c = line.match(/^-\s+(verified|unverified)\s*:\s*(.*)$/i);
    if (c) { claims.push({ label: c[1].toLowerCase(), text: c[2].trim() }); continue; }
    const bad = line.match(/^-\s+([A-Za-z][A-Za-z -]{0,30}?)\s*:\s*(.*)$/);
    if (bad && !/^evidence$/i.test(bad[1].trim())) claims.push({ label: bad[1].trim().toLowerCase(), text: bad[2], malformed: true });
  }
  return { meta, claims, status };
}

const CONFIDENCE = /(\d{1,3}\s*%\s*(confiden|certain|sure|likely))|((confiden|certain)[a-z]*\s*(of|at|:)?\s*\d{1,3}\s*%)|\b(likely correct|probably (fine|correct|right)|should be fine|appears to be correct|i believe|seems right)\b/i;

// Returns { ok, problems[] }. The rules are the product: two labels, evidence on every verified claim, no confidence language.
export function validate(text, { expectedHash } = {}) {
  const problems = [];
  if (!text || !text.trim()) return { ok: false, problems: ['report is empty'] };
  const { meta, claims, status } = parse(text);
  if (!meta.diff_hash) problems.push('missing "diff_hash:" line');
  else if (expectedHash && meta.diff_hash !== expectedHash) problems.push(`diff_hash ${meta.diff_hash} does not match the current diff ${expectedHash}`);
  if (!claims.length) problems.push('no claims: every finding must be a "- verified:" or "- unverified:" line');
  for (const c of claims) {
    if (c.malformed) problems.push(`claim label "${c.label}" is not allowed; use verified or unverified: "${c.text.slice(0, 60)}"`);
    else if (c.label === 'verified' && !/evidence\s*:/i.test(c.text)) problems.push(`verified claim without "Evidence:": "${c.text.slice(0, 60)}"`);
    else if (c.label === 'unverified' && !/(registered|why|because|no\s|not\s|could not|cannot|missing)/i.test(c.text)) problems.push(`unverified claim needs a reason: "${c.text.slice(0, 60)}"`);
  }
  const conf = text.match(CONFIDENCE);
  if (conf) problems.push(`confidence language is not allowed: "${conf[0]}". Use verified or unverified.`);
  if (!status) problems.push('missing "status:" line in a Verdict section (verified | unverified-claims-present (n))');
  return { ok: problems.length === 0, problems, meta, claims, status };
}

export function find(ctx, hash) {
  const text = readText(recordPath(ctx, hash), null);
  return text == null ? null : { text, ...parse(text), path: recordPath(ctx, hash) };
}

export function writePending(ctx, classification, extra = {}) {
  ensureDir(ctx.files.verifications);
  const p = pendingPath(ctx, classification.hash);
  writeJson(p, { hash: classification.hash, tier: classification.tier, base: classification.base, files: classification.files, triggers: classification.triggers, branch: extra.branch || '', created: stamp(), ...extra });
  return p;
}

export function newestPending(ctx, maxAgeMin = 240) {
  let names = [];
  try { names = fs.readdirSync(ctx.files.verifications).filter((n) => n.endsWith('.pending.json')); } catch { return null; }
  let best = null;
  for (const n of names) {
    const p = path.join(ctx.files.verifications, n);
    const st = fs.statSync(p);
    if ((Date.now() - st.mtimeMs) / 60000 > maxAgeMin) continue;
    if (!best || st.mtimeMs > best.mtime) best = { path: p, mtime: st.mtimeMs, data: readJson(p, {}) };
  }
  return best;
}

export function clearPending(ctx, hash) { try { fs.unlinkSync(pendingPath(ctx, hash)); } catch { /* ignore */ } }

export function list(ctx) {
  let names = [];
  try { names = fs.readdirSync(ctx.files.verifications).filter((n) => n.endsWith('.md')); } catch { return []; }
  return names.map((n) => { const p = path.join(ctx.files.verifications, n); const t = readText(p, ''); return { path: p, hash: n.replace(/\.md$/, ''), mtime: fs.statSync(p).mtime, ...parse(t) }; });
}

export function templateFor(pending, verifyInstructions) {
  return `diff_hash: ${pending.hash}
branch: ${pending.branch || '-'}
base: ${pending.base || '-'}
tier: ${pending.tier}
triggers: ${(pending.triggers || []).map((t) => `${t.file} (${t.reason})`).join('; ') || '-'}
verifier: watchkeeper:verifier
run: ${stamp()}
commands_run: <n>

## Claims
- verified: <what you checked>. Evidence: <command you ran or file:line you read>.
- unverified: <what you could not check>. <why>. Registered.

## Verdict
status: <verified | unverified-claims-present (n)>
${verifyInstructions ? '\n<!-- project instructions were read from .watchkeeper/VERIFY.md -->\n' : ''}`;
}
