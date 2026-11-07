---
name: claim
description: Claim ownership of an area (a directory or configured area) on OWNERSHIP.md for this session. Use before starting work on an area, or with --takeover to take an area from a stale or dead session.
argument-hint: "<area> [--takeover] [--note \"…\"]"
allowed-tools: Bash(node *)
---

```
!`node "${CLAUDE_PLUGIN_ROOT}/bin/wk.mjs" claim $ARGUMENTS --session "$WATCHKEEPER_SESSION"`
```

Report the one-line result. If it was refused because a live session owns the area, do not take it over on your own: tell the user who owns it and offer `--takeover`, which records the takeover in DECISIONS.md.
