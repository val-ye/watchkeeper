// Shared entry for hooks: parse stdin, resolve context, swallow errors so a broken hook never blocks the user.
import { readStdinJson, log } from '../lib/util.mjs';
import { resolveContext } from '../lib/paths.mjs';

export function hookMain(fn) {
  const input = readStdinJson();
  let ctx = null;
  try { ctx = resolveContext(input.cwd || process.cwd()); } catch (e) { log('ctx failed', e.message); }
  if (!ctx || !ctx.initialized) { process.exit(0); }
  try {
    const out = fn(ctx, input);
    if (out && typeof out === 'object') process.stdout.write(JSON.stringify(out) + '\n');
    else if (typeof out === 'string' && out) process.stdout.write(out);
    process.exit(typeof out === 'object' && out && out.__exit ? out.__exit : 0);
  } catch (e) {
    log('hook error', e.stack || e.message);
    if (process.env.WATCHKEEPER_DEBUG) process.stderr.write(`watchkeeper hook error: ${e.message}\n`);
    process.exit(0);
  }
}

export function deny(reason) {
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } };
}

export function allowWithContext(text) {
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', additionalContext: text } };
}

export function exit2(message) {
  process.stderr.write(message + '\n');
  process.exit(2);
}
