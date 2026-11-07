---
name: release
description: Release ownership of one or more areas when the work on them is finished. Requires a decision entry since the last edit. Use when done with an area, before stopping, or when handing work to another session.
argument-hint: "[area…] [--note \"…\"] [--force]"
allowed-tools: Bash(node *)
---

```
!`node "${CLAUDE_PLUGIN_ROOT}/bin/wk.mjs" release $ARGUMENTS --session "$WATCHKEEPER_SESSION"`
```

If it refuses because edits happened since the last decision entry, write the entry first with /watchkeeper:decide, then release. Do not use `--force` unless the user asks.
