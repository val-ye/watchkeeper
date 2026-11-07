import { hookMain } from './_common.mjs';
import * as sessions from '../lib/sessions.mjs';
hookMain((ctx, input) => { sessions.touch(ctx, input.session_id || 'unknown'); return null; });
