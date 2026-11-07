---
name: init
description: Initialize watchkeeper in the current repository (board, decision log, config, verify instructions). Use when the user says "set up watchkeeper", "init watchkeeper", or on first use in a repo.
argument-hint: "[--local] [--mode deny|warn] [--areas src/,db/] [--base develop]"
allowed-tools: Bash(node *), Read
---

Run this and show the user the output verbatim:

```
!`node "${CLAUDE_PLUGIN_ROOT}/bin/wk.mjs" init $ARGUMENTS`
```

Then, in at most six lines, tell the user:
- which files were created and that OWNERSHIP.md and `.watchkeeper/local/` are excluded from git locally; with `--local` everything is excluded (nothing appears in `git status` for teammates);
- that they should list areas in `.watchkeeper/config.json` if the default (first path segment) is too coarse, and set `base_branch` if it is not develop/main;
- that `.watchkeeper/VERIFY.md` is where they tell the verifier how to check things in this repo;
- that hooks are silent in repositories without `.watchkeeper/config.json`.

Requires Node 18 or newer on PATH. If the command fails with "node: command not found", say so and stop.
