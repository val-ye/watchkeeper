---
name: decide
description: Append one dated row to DECISIONS.md (append-only). Use after making a design or implementation decision, when changing an earlier decision (--supersedes), or to record an OPEN question for a human (--open). Never edit DECISIONS.md directly.
argument-hint: "<area> \"<decision, one line>\" [--basis \"evidence\"] [--supersedes d-0001] [--open]"
allowed-tools: Bash(node *)
---

Write the decision as a fact someone can act on, in one line, no hedging, no first person. Put the evidence or the person who decided in `--basis`.

```
!`node "${CLAUDE_PLUGIN_ROOT}/bin/wk.mjs" decide $ARGUMENTS --session "$WATCHKEEPER_SESSION"`
```

Report the id. If the row supersedes an earlier one, say which.
