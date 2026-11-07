# Design: an operational layer for many long-lived coding agents on one codebase

Status: Phase 0 draft, 2026-11-06. No code written. Awaiting review.
Working name was `handoff`. Chosen name (Val, 2026-11-06): `watchkeeper` (see section 2).

## 1. Problem

Several Claude Code sessions work on one repository for hours, often while the
human is away. Each session knows only its own transcript. Observed failures
(three months of session logs on a 50-engineer BI platform, 2026-08 to 2026-11):

- The same work done twice: a branch pushed by two sessions, a date fix made by
  the day session and the night worker, the same question asked three times.
- A design question re-argued every session because the earlier answer lived
  in one transcript. One variance scale moved five times.
- Dirty worktrees left behind when a session died or was killed, discovered
  days later with unpushed commits.
- A manager session merging a PR that carried someone else's commits because
  nobody had written down what it was and was not allowed to do.
- Review agents reporting "85% confident" on SQL that was never run.

Root cause was shared state, not team mechanics. Built-in Agent Teams were
evaluated for this and rejected for global use: one team per session, lead
fixed, no resume, teammates die with the lead, nothing persists between days.

What is needed is a small set of plain files that every session reads first
and writes last, plus hooks that keep those files honest when the session
forgets, plus two roles (manager, verifier) with written limits.

## 2. Name

`handoff` is crowded. npm `handoff` is taken (1.3.2). GitHub has
`hallee9000/heron-handoff` (352 stars), `joshuadavidthomas/opencode-handoff`
(182), `pion/handoff` (188), and roughly ten "handoff skill for Claude" repos
(`sterben-s/project-handoff-claude`, `pformoso-deus-ai/handoff-claude-skill`,
`asad1995ali/handoff-Claude`, and more). A plugin by that name would be one
of a dozen in search results and would be confused with single-session
handoff-note skills, which is not what this is.

Three alternatives, checked on npm and GitHub on 2026-11-06:

| Name | npm | GitHub collisions | Note |
|---|---|---|---|
| `changeover` | free | none relevant (a Twitch ad blocker, two CNC datasets) | Shift changeover is exactly the concept. Plain English. |
| `watchkeeper` (chosen by Val 2026-11-06) | free | `razee-io/WatchKeeper` (8 stars, Kubernetes) | Nautical vocabulary carries the whole model (watchbill, deck log, officer of the watch). Two zero-star agent-crew repos already use "watchbill". |
| `shift-turnover` | free | none | Literal. Longer to type. |

Rejected: `nightshift` (three direct competitors use it, 1,076 / 108 / 64
stars), `baton`, `relay`, `nightwatch`, `turnover`, `muster`, `quarterdeck`
(all taken on npm or GitHub). Plugin names may not start with `claude-` or
`anthropic-` per the manifest reference.

The slash command the human types in the morning is `/watchkeeper:handoff`.
The rest of this document uses `watchkeeper` as the plugin name and
`handoff` as the command name.

## 3. What exists (survey, stars as of 2026-11-06)

Five capabilities under design: C1 ownership board, C2 append-only decision
log with supersedes, C3 lifecycle hooks incl. orphan marking, C4 manager with
written revocable authorization, C5 diff-triggered independent verifier with
binary provenance and an assumptions register.

Closest in concept
- `Sovereign-Labs-AU/watchbill` (0). Markdown ledger protocol for many agent
  sessions and one human: CLAIMS.md with time-bounded leases and visible
  expiry, DIARY.md append-only log, stale flags after 72h. Covers C1, part of
  C2 and C3 as a protocol. No Claude hooks, no manager, no verifier, no users.
- `jrabercrombie/watchbill` (0). Lead session dispatches subagents into
  worktrees, append-only file mailbox, "claims are notices not locks",
  read-only reviewer told not to trust reports. Part of C1, C4, C5. No
  authorization file, verifier always-on and after merge.
- `orwa-mahmoud/nightshift` (108). Single-agent "work contract" for long
  shifts: punch list on disk, clock-out gate that refuses premature exit,
  parked decisions, per-item receipts. Covers C3 for one agent. Nothing
  multi-agent. Closest in spirit; an interop target, not a competitor.
- `marcus/nightshift` (1,076). Go daemon spending leftover budget overnight on
  catalogued chores, PR-only output, never merges. Part of C4 (safety rail).
- `openslop/nightshift` (64). Cron wakes an agent for one small job, PRs only,
  a second timer reviews open PRs. Part of C4 and C5, generic review.

Coordination platforms (heavy, not plain files)
- `ruvnet/claude-flow` (81,073). Swarm harness with memory and hive-mind.
- `steveyegge/gastown` (18,717) + `steveyegge/beads` (28,557). Mayor
  coordinator, workers with identity, Dolt-backed issue graph with
  `bd update --claim`. Task claims, not file areas. Mayor merges without a
  written scoped mandate. Biggest real competitor on coordination.
- `openai/symphony` (27,956). Tracker issues to isolated autonomous runs.
- `BloopAI/vibe-kanban` (28,609), `smtg-ai/claude-squad` (8,741),
  `stravu/crystal` (3,127), `kbwo/ccmanager` (1,278), Conductor (closed).
  Session and worktree multiplexers. Human merges. None of C1 to C5.
- `jayminwest/overstory` (1,313, archived). Workers in worktrees, SQLite mail,
  tiered merge resolution.
- `vignesh07/aqua` (25). Shared task queue with atomic claim and hard file
  locks via a server.
- `MrLesk/Backlog.md` (7,297). Markdown tasks, docs and decisions folders.
  Plain decision files, no append rule, no supersedes.

Review and verification
- `obra/superpowers` (313,548). `verification-before-completion`: no
  completion claim without fresh evidence. Self-verification by the same
  agent. Reuse the wording, do not compete.
- `EveryInc/compound-engineering-plugin` (25,958). About 15 review agents,
  always on, generic.
- Anthropic `code-review` plugin. Four agents, confidence 0 to 100, posts at
  80 and above. The percentage is the thing C5 bans.
- Anthropic `pr-review-toolkit`, `feature-dev`, `hookify` (regex hooks,
  useful substrate for trigger detection), `ralph-loop` (Stop-hook re-entry
  pattern to copy), `tdd-guard` by `nizos` (2,373, PreToolUse content gate).
- `npryce/adr-tools` (5,766), `thomvaill/log4brains` (1,609). "Superseded by
  ADR-N" is the vocabulary to adopt for C2.

Memory
- `thedotmack/claude-mem` (113,951), `mem0ai/mem0` (68,530),
  `oceanbase/powercontext` (1,510). Episodic memory injected per session.
  Not decisions as records, not ownership.

Built in to Claude Code (verified against docs 2026-11-06)
- Agent Teams: experimental, `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`, shared
  task list with file-locked claims, `TeammateIdle` / `TaskCompleted` /
  `TaskCreated` hooks, interactive only, one team per session, lead fixed,
  no resume, teammates share the working directory and the docs say "give
  each teammate its own files" with no enforcement.
- `isolation: worktree` on the Agent tool removes the worktree only if
  unchanged, so a dirty orphan already persists on disk silently.
- `/loop`, cross-session `SendMessage`, `claude agents --json` (background
  sessions only: `id`, `name`, `state`, `cwd`, `startedAt`, `sessionId`).
- No official handoff file. `anthropics/claude-code` issue 11455 proposes
  `.claude/handoff.md`, unshipped.

### 3a. Gap

Not found anywhere:
1. A file-area ownership board with status and last-touched that hooks read
   and write automatically. Everything else claims tasks or hard-locks files.
2. A manager that merges green PRs under a written, revocable, scoped
   authorization file, and reconciles the board. Existing tools either never
   merge or merge on their own judgment.
3. A verifier gate keyed on diff content (SQL, formulas, thresholds, views,
   production config), run before human review, with verified / unverified
   labels only and an assumptions register that blocks merge.
4. Marking a dirty abandoned worktree as orphaned on a board anyone reads.

Well covered, reuse instead:
- Single-session handoff notes (ten skills). Borrow the contract shape from
  `pformoso-deus-ai/handoff-claude-skill` and the "test the handoff doc with
  a fresh agent" idea from `not-modest/passthebaton`.
- Worktree isolation and multiplexing: built in, `claude-squad`, Conductor.
- Task claiming with dependencies: built-in Agent Teams task list.
- Supersedes vocabulary: ADR conventions.
- Verification discipline wording: superpowers.
- Hook mechanics: `ralph-loop`, `hookify`, `tdd-guard`.

## 4. What this adds

One plugin, one file protocol, four plain files a human can read without
tools, hooks that keep them true, two roles with written limits.

Positioning sentence: "A watch-changeover protocol for coding agents. Who owns
what, what was decided, what was left dirty, what was verified, and what the
manager is allowed to do, in files that survive the session."

Not a scheduler, not a task tracker, not memory, not a worktree multiplexer.
It sits beside those. Interop targets: Agent Teams hooks, `/loop`,
`isolation: worktree`, `orwa-mahmoud/nightshift`, `beads`.

## 5. Facts from the current docs that constrain the design

Read from code.claude.com/docs on 2026-11-06. Full citations in section 13.

- Plugin layout: `.claude-plugin/plugin.json` (only `name` required; names may
  not start with `claude-`), then `skills/<name>/SKILL.md`, `agents/*.md`,
  `hooks/hooks.json` (events wrapped in a top-level `hooks` key), `.mcp.json`.
  `commands/` still works but the docs say to write new ones as skills.
  A `CLAUDE.md` at plugin root is not loaded.
- `${CLAUDE_PLUGIN_ROOT}` changes on every update. State goes in
  `${CLAUDE_PLUGIN_DATA}` (`~/.claude/plugins/data/<id>/`) or in the project.
  `${CLAUDE_PROJECT_DIR}` is the session start root and stays fixed inside
  worktrees. `userConfig` keys arrive as `CLAUDE_PLUGIN_OPTION_<KEY>`.
- Hook events today: SessionStart, Setup, UserPromptSubmit, PreToolUse,
  PermissionRequest, PostToolUse, PostToolUseFailure, Notification,
  SubagentStart, SubagentStop, TaskCreated, TaskCompleted, Stop, StopFailure,
  TeammateIdle, InstructionsLoaded, ConfigChange, CwdChanged, FileChanged,
  WorktreeCreate, WorktreeRemove, PreCompact, PostCompact, SessionEnd, plus a
  few UI events. Hook types: command, http, mcp_tool, prompt, agent
  (experimental). `async: true` exists for command hooks; async hooks cannot
  decide anything.
- SessionStart: `source` is startup / resume / clear / compact / fork. Plain
  stdout on exit 0 becomes context. `CLAUDE_ENV_FILE` is writable here.
- Stop: input has `stop_hook_active`, `last_assistant_message`. Exit 2 or
  `{"decision":"block","reason":…}` keeps Claude working; capped at 8
  consecutive continuations. `additionalContext` injects without blocking.
  No matcher.
- SessionEnd: `reason` is clear / resume / logout / prompt_input_exit / other.
  Cannot block, JSON output is discarded, default budget 1.5 s
  (`CLAUDE_CODE_SESSIONEND_HOOKS_TIMEOUT_MS` to raise). Consequence: anything
  that needs the model (writing a decision entry) must happen in Stop;
  SessionEnd can only do fast bookkeeping.
- PreToolUse: matcher is the tool name; output `hookSpecificOutput.
  permissionDecision` allow / deny / ask with `permissionDecisionReason`, or
  `additionalContext`. `additionalContext` is capped at 10,000 characters.
- SubagentStop: input has `agent_type` (matcher), `agent_transcript_path`,
  `last_assistant_message`. Exit 2 keeps the subagent working.
- Plugin agents: `permissionMode`, `hooks`, `mcpServers`, `initialPrompt` in
  frontmatter are ignored for plugin agents. Agents are addressed as
  `<plugin>:<name>`. No documented way for a hook to force a subagent; the
  documented pattern is a hook that denies or blocks with a reason telling
  Claude to run it.
- Skills: `/plugin-name:skill-name`, `$ARGUMENTS`, `!`cmd`` preprocessing
  runs before the model sees the skill, `context: fork` runs in a subagent,
  `disable-model-invocation`, `allowed-tools`, `hooks` (with `once`).
- Marketplace: a repo with `.claude-plugin/marketplace.json` at its root
  (`name`, `owner`, `plugins: [{name, source: "./"}]`) is installable with
  `/plugin marketplace add owner/repo` then `/plugin install name@marketplace`.
  `claude plugin validate <path> --strict` and `--profile directory` exist in
  the installed CLI (2.1.319) and check what the directory submission checks
  (README present, hooks and MCP files parse). `claude plugin eval` exists.
  Submission to Anthropic's directory is through claude.ai/directory/manage
  on a paid plan; the official-marketplace README also links a submission
  form (clau.de/plugin-directory-submission). Which one is current is an open
  question for Phase 2.
- Agent Teams: see section 3. Lead cannot be the manager role here because
  the lead dies with the session.

## 6. Architecture

```
<repo primary worktree>/
  OWNERSHIP.md              board, rendered from strict rows, human-readable, local-only
  DECISIONS.md              append-only, committed, never edited
  AUTHORIZATION.md          manager mandate, present only while a mandate is active
  .watchkeeper/
    config.json             areas, verifier tiers, options (committed)
    VERIFY.md               project-specific verification instructions (committed)
    ASSUMPTIONS.md          open unverified claims, must be empty to merge (committed)
    verifications/<hash>.md verifier reports keyed by diff hash (committed)
    local/                  excluded via .git/info/exclude, never committed
      sessions/<id>.json    live session records with heartbeat
      lock/                 mkdir-based lock for board writes
```

Why the primary worktree: a board that lives inside each worktree would be
one board per branch, which is no board. Hooks resolve the primary worktree
from `git rev-parse --git-common-dir` and read and write there from any
worktree. A bare repository with only linked worktrees falls back to
`${CLAUDE_PLUGIN_DATA}/<repo-hash>/`.

Why `.git/info/exclude`: OWNERSHIP.md and `local/` are runtime state. Putting
them in the repo's `.gitignore` would require a commit to a repo the plugin
does not own. `info/exclude` is per-clone and invisible to collaborators.

Why DECISIONS.md is committed and OWNERSHIP.md is not: decisions are durable
knowledge and must survive a re-clone and reach collaborators. Ownership is
true only while sessions are alive. A single copy in the primary worktree
also means append-only entries never merge-conflict, because feature
branches never carry the file.

Plugin layout (per current docs):

```
watchkeeper/
  .claude-plugin/plugin.json      name, version, description, author, license MIT,
                                  repository, keywords, userConfig
  .claude-plugin/marketplace.json self-hosted single-plugin marketplace
  hooks/hooks.json
  hooks/*.mjs                     one file per event, Node 18+, zero dependencies
  lib/*.mjs                       board, decisions, git, tiers, lock, render
  agents/verifier.md              independent verifier subagent
  skills/init/SKILL.md            /watchkeeper:init
  skills/claim/SKILL.md           /watchkeeper:claim <area> [--takeover]
  skills/release/SKILL.md         /watchkeeper:release [area]
  skills/decide/SKILL.md          /watchkeeper:decide <area> <text> [--supersedes <id>]
  skills/verify/SKILL.md          /watchkeeper:verify  (runs the verifier on the current diff)
  skills/manage/SKILL.md          /watchkeeper:manage  (one manager pass; run under /loop)
  skills/handoff/SKILL.md         /watchkeeper:handoff (morning takeover summary)
  templates/                      OWNERSHIP.md, DECISIONS.md, AUTHORIZATION.md, VERIFY.md,
                                  config.json, github-action gate workflow
  examples/bakery/                synthetic demo repo with snapshots t0..t4
  tests/                          node --test, fixtures build temp git repos
  .github/workflows/ci.yml        tests on ubuntu+macos, node 18/20/22, plugin validate
  README.md  LICENSE  CHANGELOG.md  docs/design.md
```

Implementation language: Node ESM, no dependencies, `node --test` for tests.
Reasons: JSON in and out of every hook without `jq`; the same script runs on
macOS, Linux and Windows (bash hooks need Git Bash on Windows); the built-in
test runner needs nothing installed. Cost: Node 18+ must be on PATH. The
native Claude Code installer does not require Node, so the README states the
requirement and `/watchkeeper:init` checks it. Official plugins use bash+jq
(`ralph-loop`) and python (`hookify`); neither is more portable than Node.

Scripts are the source of truth for every number the human sees. Skills call
scripts through `!`cmd`` preprocessing and only present the result. The
model never computes a count, a date or a path that a script can compute.

## 7. File schemas

### 7.1 OWNERSHIP.md

Strict table, one row per area, no pipes inside cells, cells at most 80
characters, rewritten atomically under lock. Both the truth and the view;
humans may edit it, scripts parse it. Rows outside the grammar are preserved
in a "Notes" section and flagged.

```
# OWNERSHIP - who owns what, right now
Reconciled: 2026-11-06 07:40 PST by manager c3d1

| Area | Owner | Status | Since | Last touched | Branch / worktree | Note |
|---|---|---|---|---|---|---|
| src/pricing/ | 7f2a | active | 11-05 22:10 | 11-06 03:14 | feat/pricing-tiers @ wt/pricing | tests green, PR #12 open |
| db/views/ | 9b40 | orphaned-dirty | 11-05 23:02 | 11-06 01:50 | feat/daily-rollup @ wt/rollup | 3 uncommitted files, 1 unpushed commit |
| web/checkout/ | - | released | - | 11-05 18:00 | - | last owner a1c9, decision d-0041 |
```

Fields
- Area: a path prefix or glob from `config.json` `areas`. Default area for an
  unlisted path is its first path segment.
- Owner: 4-char short session id (first 4 of `session_id`) or `-`.
- Status: `active` (edits in the last heartbeat window), `idle` (alive, no
  edits), `released` (owner wrote a decision entry and released),
  `orphaned-dirty` (owner gone, worktree dirty or unpushed),
  `orphaned-clean` (owner gone, nothing left behind, row kept one day),
  `handoff-pending` (owner stopped, decision entry missing).
- Since / Last touched: local time, minute precision, year dropped when it is
  the current year.
- Branch / worktree: `branch @ worktree-name`, or `-`.
- Note: free text, 80 chars, written by the owner through `/watchkeeper:claim`
  or `/watchkeeper:release`, or by hooks ("3 uncommitted files").

Reconciliation sections below the table: `## Orphaned worktrees` (path,
branch, dirty count, unpushed count, last owner), `## Live sessions` (short
id, role, cwd, heartbeat age).

### 7.2 DECISIONS.md

Append-only. One entry per decision. Never edited; a wrong entry is
superseded by a new one. Ids are sequential per file.

```
# DECISIONS - append-only

| Id | Date | Area | Decision | Basis | By | Supersedes |
|---|---|---|---|---|---|---|
| d-0040 | 2026-11-05 22:14 | src/pricing/ | Tier boundaries live in config, not code | PR review 11-04, two sessions hardcoded them | 7f2a | - |
| d-0041 | 2026-11-05 23:40 | web/checkout/ | Checkout keeps the old form; redesign parked | human, Slack 11-05 | a1c9 | - |
| d-0042 | 2026-11-06 02:05 | src/pricing/ | Boundaries in config.json, not env vars | env vars unreadable to the dashboard | 7f2a | d-0040 |
| OPEN | 2026-11-06 02:30 | db/views/ | Daily rollup grain: user or household? Raised 11-05, 11-06 | 9b40 | - | - |
```

Rules enforced by `lib/decisions.mjs`: append only (the script refuses to
write anything but a new last row), `Supersedes` must name an existing id,
an `OPEN` row records every date the question was raised so no session
re-derives it, a manager action is a decision with `By = manager <id>` and
`Basis = AUTHORIZATION.md <hash>`. Superseded entries are not marked in
place; the render script shows `(superseded by d-0042)` in the
morning summary and in SessionStart context.

### 7.3 AUTHORIZATION.md

Present only while a mandate is active. Absence means the manager may only
read and reconcile.

```
# AUTHORIZATION - manager mandate

granted_by: <human name>
granted_at: 2026-11-05 21:50 PST
expires_at: 2026-11-06 10:00 PST
repos: this repository
target_branches: develop
actions: merge, comment, close-stale
require: all checks green; ASSUMPTIONS.md empty for the PR; Tier 2 diffs have a verification record;
         every commit authored by: 7f2a, 9b40, a1c9 (session ids) or <human>
never: main, master, release/*, force-push, rebase, squash-rewrite, config changes
max_merges: 5
revoke: delete this file, or add a line `revoked_at: <time>`
```

The manager hook hashes this file; every merge it performs records the hash
in DECISIONS.md so a later reader can see which mandate was in force.

### 7.4 .watchkeeper/config.json

```json
{
  "areas": ["src/pricing/", "db/views/", "web/**"],
  "ownership": { "mode": "deny", "stale_after_minutes": 90 },
  "decisions_on_start": 10,
  "stop_gate": "auto",
  "tiers": {
    "2": {
      "paths": ["**/*.sql", "db/**", "**/helm/**", ".github/workflows/**", "**/*.tf", "**/config/*.{json,yaml,yml}"],
      "content": ["\\bCREATE\\s+(OR\\s+REPLACE\\s+)?(VIEW|TABLE|MATERIALIZED)", "\\bSELECT\\b", "threshold", "_pct\\b", "forecast", "projection"]
    },
    "1": { "paths": ["docs/**", "**/*.md"], "content": [] }
  }
}
```

`ownership.mode`: `deny` blocks edits to areas owned by another live
session; `warn` only injects context. Stale owners (heartbeat older than
`stale_after_minutes`) downgrade deny to warn. `stop_gate`: `auto` detects
background sessions, `always`, `off`.

### 7.5 Verification record `.watchkeeper/verifications/<hash>.md`

```
diff_hash: 3f9c…   (sha256 of the unified diff vs base, whitespace-normalized)
branch: feat/daily-rollup   base: develop   tier: 2
triggers: db/views/daily_rollup.sql (path), CREATE OR REPLACE VIEW (content)
verifier: watchkeeper:verifier   run: 2026-11-06 02:40   commands_run: 4

## Claims
- verified: view compiles; `EXPLAIN` ran, 0 errors. Evidence: command 1.
- verified: row count for 2026-11-04 matches source within 0 rows. Evidence: command 3 vs command 2.
- unverified: household dedupe assumed per day; no source of truth found. Registered: ASSUMPTIONS.md a-007.

## Verdict
status: unverified-claims-present (1)
```

Only two labels exist. The SubagentStop hook rejects a report containing a
percentage next to "confiden" or the words "likely correct", "probably", or
"should be fine", and sends the verifier back with the rule.

### 7.6 .watchkeeper/ASSUMPTIONS.md

```
| Id | Opened | Branch | Area | Claim | Why unverified | Closed |
|---|---|---|---|---|---|---|
| a-007 | 2026-11-06 02:40 | feat/daily-rollup | db/views/ | dedupe is per household per day | no upstream doc found | - |
```

A row closes by a later verification record (`Closed = v-<hash>`) or by a
human writing a decision (`Closed = d-0043`). The merge gate counts rows with
`Closed = -` for the PR's branch.

### 7.7 Session record `.watchkeeper/local/sessions/<id>.json`

```json
{ "id": "7f2a…", "short": "7f2a", "role": "worker", "cwd": "…", "worktree": "wt/pricing",
  "branch": "feat/pricing-tiers", "started": "…", "heartbeat": "…", "edits": 14,
  "last_decision_at": "…", "background": true }
```

## 8. Hook-by-hook behavior

All hooks: exit 0 and print nothing when the repository has no
`.watchkeeper/config.json`, so installing the plugin changes nothing until
`/watchkeeper:init` runs in a repo. Every hook has a hard internal timeout and
fails open (never blocks the user because the hook broke), except the two
deny decisions in 8.3 and 8.6 which fail closed only when the board is
readable and says deny.

### 8.1 SessionStart (matcher: startup | resume | clear | compact)

1. Resolve primary worktree; load config. Write the session record
   (`started`, `cwd`, `worktree`, `branch`). `background` is detected by
   matching `session_id` against `claude agents --json` (one call, 300 ms
   budget, falls back to false).
2. Print context (under 10,000 chars): the OWNERSHIP table with rows owned
   by other live sessions marked "off limits"; the last N decisions with
   superseded ones struck; all OPEN rows; open ASSUMPTIONS for the current
   branch; whether AUTHORIZATION.md is active; a four-line protocol ("claim
   before editing, decide before releasing, never edit DECISIONS.md, run
   /watchkeeper:handoff to brief a human").
3. On `compact`, print only the table and the protocol.
4. Append `WATCHKEEPER_ROOT`, `WATCHKEEPER_SESSION` to `CLAUDE_ENV_FILE`.

### 8.2 UserPromptSubmit

Heartbeat only (touch the session record). No output.

### 8.3 PreToolUse (matcher: Edit | Write | MultiEdit | NotebookEdit)

Map `tool_input.file_path` to an area. If the area is owned by another
session whose heartbeat is fresh: `permissionDecision: deny` with reason
"owned by 9b40 since 23:02 (feat/daily-rollup). Message them, or
`/watchkeeper:claim db/views/ --takeover` which records the takeover in
DECISIONS.md." If the owner is stale: allow with `additionalContext` warning.
If unowned: allow (the claim happens in 8.4).

Known gap: edits through Bash (`sed`, heredocs) are not seen. Documented, not
solved; a Bash matcher on write-like commands is a Phase 1 option behind a
config flag, default off because of false positives.

### 8.4 PostToolUse (matcher: Edit | Write | MultiEdit | NotebookEdit)

If the area is unowned, claim it for this session (status `active`, note
"auto-claimed on first edit"). Update `Last touched`, increment `edits`.
Status of owned areas with no edits in the stale window becomes `idle` at
the next write.

### 8.5 Stop

1. Heartbeat; refresh `active` / `idle`.
2. Classify the working tree diff against base into a tier (lib/tiers) and
   cache it in the session record, so the agent is told "this change is
   Tier 2; a verification record is required before push" via
   `additionalContext` once per tier change.
3. Handoff gate: if this session owns areas, has edits since
   `last_decision_at`, and `stop_hook_active` is false, and the gate applies
   (`stop_gate: always`, or `auto` with `background: true`), return
   `decision: block` with reason "Write one DECISIONS entry for what you
   changed and why (`/watchkeeper:decide <area> <text>`), then release or
   keep ownership (`/watchkeeper:release`)." Fires at most once per stop
   cycle because `stop_hook_active` is true on re-entry. Interactive
   sessions get the same text as `additionalContext` instead of a block.

### 8.6 PreToolUse (matcher: Bash)

Regex on `tool_input.command`:
- `git push` or `gh pr create`: compute diff vs base, tier. Tier 2 without a
  matching verification record (same `diff_hash`) → deny with reason "Tier 2
  change (triggers: …). Run `/watchkeeper:verify` first. The record must
  match the current diff." Tier 1 → allow with a short checklist in
  `additionalContext`. Tier 0 → allow.
- `gh pr merge`: deny if ASSUMPTIONS.md has open rows for the PR's branch,
  or if a Tier 2 diff has no record. Additionally, when the session's role is
  `manager`, deny unless AUTHORIZATION.md is present, unexpired, not revoked,
  the target branch is allowed, `max_merges` not reached, and every commit
  author is in the allowed list (the hook runs `gh pr view --json commits`).
- Anything else: pass through, no output.

The same checks ship as a GitHub Actions workflow template
(`templates/gate.yml`) that reads the committed `.watchkeeper/` files, so a
merge from the web UI or another machine meets the same gate. The hook is the
fast path; the Action is the durable one.

### 8.7 SubagentStop (matcher: watchkeeper:verifier)

Read the verifier's report file. Exit 2 with the rule if it lacks
`diff_hash`, has a claim without `verified:` or `unverified:` prefix, has a
`verified:` claim without an `Evidence:` reference, or contains confidence
language. Otherwise append unverified claims to ASSUMPTIONS.md and exit 0.

### 8.8 SessionEnd (1.5 s budget, cannot block)

Fast bookkeeping only, every git call with a 400 ms timeout and
`GIT_OPTIONAL_LOCKS=0`:
1. Mark the session record `ended`, `reason`.
2. For each area owned by this session: if `last_decision_at` is after the
   last edit → `released`; else → `handoff-pending`.
3. `git status --porcelain` and `git log @{upstream}..` in the session's
   worktree. Dirty or unpushed → every area owned by this session becomes
   `orphaned-dirty` with the counts in Note, and the worktree is listed under
   `## Orphaned worktrees`.
If the budget runs out, the record stays live and the next reconciliation
(8.9) catches it by heartbeat age.

### 8.9 Reconciliation (script, run by SessionStart, `/watchkeeper:manage`, `/watchkeeper:handoff`)

Sessions with heartbeat older than `stale_after_minutes` and not in
`claude agents --json` are treated as ended; their rows go through the same
rules as 8.8. Two live sessions on one branch or one area → both rows get
Note "duplicate with <id>" and the manager messages both; the script never
picks a winner.

### 8.10 Optional Agent Teams hooks (behind `config.teams: true`)

`TaskCompleted`: exit 2 if the task's teammate edited Tier 2 paths without a
verification record. `TeammateIdle`: no-op heartbeat. The board gives teams
the file-ownership enforcement the docs ask users to do by hand.

## 9. Roles

### 9.1 Verifier (`agents/verifier.md`)

Independent: it does not read the implementing session's transcript. Input:
the diff, the tier and triggers, `.watchkeeper/VERIFY.md` (project-specific:
how to trace a number, which source tables, which commands are safe to run),
and the ASSUMPTIONS table. Tools: Read, Grep, Glob, Bash. It must run
commands, not reason about them; every `verified:` needs an `Evidence:`
pointer to a command it ran or a file line it read. It writes the record and
nothing else. It never edits code. `model` left to the user's default;
`effort` configurable.

The trigger table (section 7.4 defaults) ships with the plugin and is
overridden per repo. The defaults are tuned for data and analytics work
because that is where the author has the failure history; the README says so.

### 9.2 Manager (`skills/manage`, run in its own session under `/loop`)

One pass: reconcile (8.9); for each open PR by an allowed author with green
checks, empty ASSUMPTIONS and a Tier 2 record where needed, merge if
AUTHORIZATION.md permits, else comment what is missing; message owners of
duplicates and of `handoff-pending` rows; write every action as a decision
with the authorization hash; queue every product question as an OPEN row
and never answer it; output a short table for the human. Allowed to edit
only OWNERSHIP.md, DECISIONS.md, ASSUMPTIONS.md (closing a row needs a human
decision id). Never code, never config, never main.

### 9.3 Worker (default)

Any session. Hooks do the bookkeeping; the skills are shortcuts.

### 9.4 `/watchkeeper:handoff` (morning takeover)

A script computes, since a given time (default: the last `released` or human
session end), the board diff, orphaned worktrees with paths and counts,
decisions grouped by area with superseded ones struck, OPEN rows, manager
merges with authorization hash, verification records and open assumptions,
live sessions, and a suggested first three actions (orphans first, then OPEN
rows, then PRs waiting on a human). The skill presents it in under 40 lines.
`--since <time>` and `--write <path>` are supported. Output has no
percentages and no adjectives.

## 10. Demo (`examples/bakery/`)

A synthetic repo for a fictional bakery shop with three features worked by
three fictional sessions over one night: `pricing-tiers` (Tier 2, config
thresholds), `daily-rollup` (Tier 2, SQL view, ends orphaned-dirty with an
open assumption), `checkout-copy` (Tier 0, released cleanly). Snapshots
`t0-evening`, `t1-midnight`, `t2-0300`, `t3-manager-pass`, `t4-morning` each
hold OWNERSHIP.md, DECISIONS.md, ASSUMPTIONS.md and the `/handoff` output. No
real names, ids, or branches. The README's 60-second recording walks t0 to
t4.

## 11. Tests and CI

`node --test tests/`. Fixtures create a temp git repo with two worktrees,
feed hook JSON on stdin, assert board rows, decision appends, deny decisions,
tier classification, lock contention (two writers, one wins, none corrupt),
SessionEnd under a fake 1.5 s budget, verifier report rejection cases.
CI: ubuntu and macos, Node 18/20/22; `claude plugin validate . --strict
--profile directory` if the CLI can run unauthenticated in CI (to confirm in
Phase 1); markdown lint for hyphen-only punctuation.

## 12. Decisions taken in Phase 0 and open questions

Decided (change any of these by saying so):
1. Board and decisions live in the primary worktree, one copy per repo;
   OWNERSHIP.md local-only via `.git/info/exclude`, DECISIONS.md committed.
2. Markdown tables are the truth, with a strict grammar scripts can parse,
   rather than JSON rendered to markdown. Humans can edit; scripts rewrite
   under lock.
3. Node ESM, zero dependencies, `node --test`.
4. Verification gate fires at `git push` / `gh pr create`, not at every
   commit. Merge gate at `gh pr merge` plus a GitHub Action template.
5. Decision entries are required at release, enforced by Stop (block in
   background sessions, nudge in interactive ones), because SessionEnd
   cannot block.
6. Auto-claim on first edit; deny edits to areas owned by a live session;
   stale owners downgrade to a warning.
7. Manager is a skill run under `/loop` in its own session, not an Agent
   Teams lead and not a subagent.
8. Only `verified:` / `unverified:` labels; the SubagentStop hook enforces it.

Open questions for the reviewer:
1. Name: `watchkeeper`, `watchkeeper`, `shift-turnover`, or keep `handoff`
   despite the crowding?
2. File placement: OWNERSHIP.md, DECISIONS.md and AUTHORIZATION.md at repo
   root (visible) vs all inside `.watchkeeper/` (tidy). Draft says root for
   the three a human reads.
3. Cross-repo board: the author's own setup covers many repos from one
   parent directory. Draft scope is one board per repo; `/handoff` could
   accept several paths later. Acceptable for v1?
4. Should DECISIONS.md be committed by hooks automatically (a commit on the
   primary worktree's current branch) or left for the human/manager to
   commit? Draft: never auto-commit; the manager pass may commit it under
   mandate.
5. Default `ownership.mode`: `deny` (safe, may surprise a solo user) or
   `warn`? Draft: `deny`, with `/watchkeeper:init` asking.
6. Tier 2 trigger defaults are data-flavoured. Ship them as the default, or
   ship a neutral default (prod config, CI, infra) and a `data` preset?
7. Phase 2 directory submission: claude.ai/directory/manage (paid plan) vs
   the form linked from the official marketplace README. Confirm which
   before Phase 2.

Skipped on purpose in Phase 0: no code, no repo on GitHub, no name reserved.
`claude plugin init` scaffolds only into `~/.claude/skills/` so Phase 1 will
lay out the directory by hand against the docs instead.

## 13. Sources

- https://code.claude.com/docs/en/plugins/plugins-reference.md
- https://code.claude.com/docs/en/plugins/components.md
- https://code.claude.com/docs/en/plugins/create-marketplace.md
- https://code.claude.com/docs/en/plugins/publish.md
- https://code.claude.com/docs/en/plugins/cli-reference.md
- https://code.claude.com/docs/en/plugins/plugin-evals.md
- https://code.claude.com/docs/en/hooks.md
- https://code.claude.com/docs/en/skills.md
- https://code.claude.com/docs/en/sub-agents.md
- https://code.claude.com/docs/en/agent-teams.md
- https://github.com/anthropics/claude-plugins-official (README, `plugins/plugin-dev`, `plugins/ralph-loop`, `plugins/hookify`)
- https://github.com/anthropics/claude-code/issues/11455
- Repos in section 3, star counts via `gh api` on 2026-11-06.
- Local prototype this generalizes: STATE.md + DECISIONS.md + manager-check skill + ccgo dispatcher, 2026-10-30 to 2026-11-06.
