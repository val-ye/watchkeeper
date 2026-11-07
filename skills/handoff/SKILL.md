---
name: handoff
description: Morning takeover summary - what happened since the last handoff - orphaned worktrees, decisions, open questions, manager actions, verification state, live sessions. Use when the user comes back to the keyboard or asks "what happened overnight", "handoff", "takeover summary".
argument-hint: "[--since \"YYYY-MM-DD HH:mm\"] [--write path]"
allowed-tools: Bash(node *), Read
---

```
!`node "${CLAUDE_PLUGIN_ROOT}/bin/wk.mjs" handoff $ARGUMENTS`
```

Present the output as is. It is computed from OWNERSHIP.md, DECISIONS.md, ASSUMPTIONS.md, the verification records and git; do not add numbers, do not soften the "First" list, do not add commentary. If the user asks a follow-up, answer from those files.
