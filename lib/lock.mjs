// mkdir-based lock, atomic on every platform Node runs on. Stale after 5 s.
import fs from 'node:fs';
import path from 'node:path';
import { ensureDir, log } from './util.mjs';

const STALE_MS = 5000;
const RETRIES = 150;
const WAIT_MS = 20;

function sleep(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

export function withLock(ctx, fn) {
  const lockDir = ctx.files.lock;
  ensureDir(path.dirname(lockDir));
  let held = false;
  for (let i = 0; i < RETRIES; i++) {
    try { fs.mkdirSync(lockDir); held = true; break; } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try {
        const age = Date.now() - fs.statSync(lockDir).mtimeMs;
        if (age > STALE_MS) { log('stealing stale lock', age); fs.rmdirSync(lockDir); continue; }
      } catch { /* vanished */ }
      sleep(WAIT_MS);
    }
  }
  if (!held) throw new Error('watchkeeper: could not acquire board lock');
  try { return fn(); } finally { try { fs.rmdirSync(lockDir); } catch { /* ignore */ } }
}
