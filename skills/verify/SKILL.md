---
name: verify
description: Run the independent verifier on the current change before push or PR. Required for Tier 2 changes (SQL, formulas, thresholds, views, production config). Writes .watchkeeper/verifications/<hash>.md with verified / unverified claims; unverified ones go to ASSUMPTIONS.md.
argument-hint: "[--committed]"
allowed-tools: Bash(node *), Agent, Read
---

Step 1. Prepare the brief:

```
!`node "${CLAUDE_PLUGIN_ROOT}/bin/wk.mjs" verify-prepare $ARGUMENTS`
```

If the output is `NO_CHANGES`, say so and stop.

Step 2. Launch the verifier with the Agent tool, `subagent_type: "watchkeeper:verifier"`, passing the entire output of step 1 as the prompt, prefixed with: "Verify this change. Write the record to RECORD_PATH exactly in the template format. Only verified: / unverified: labels. Evidence on every verified claim." Do not add your own opinion of the change to the prompt.

Step 3. When the verifier returns, run:

```
node "${CLAUDE_PLUGIN_ROOT}/bin/wk.mjs" verify-check
```

Report in at most four lines: the record path, counts of verified and unverified claims, which assumptions were registered, and whether the branch can go out (Tier 2 with a record) and merge (no open assumptions).
