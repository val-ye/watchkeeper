# watchkeeper

A shift-changeover protocol for several Claude Code sessions working on one repository, especially while nobody is watching. It keeps four plain files true: who owns which area right now, what was decided, what the manager is allowed to do, and what was verified.

## Install (2 minutes)

Requires Claude Code and Node 18 or newer.

```
/plugin marketplace add val-ye/watchkeeper
/plugin install watchkeeper@watchkeeper
```

Then, inside the repository you want to protect:

```
/watchkeeper:init
```

Add `--local` to keep every watchkeeper file out of `git status` (nothing reaches your teammates). Without it, `DECISIONS.md` and `.watchkeeper/` are meant to be committed; `OWNERSHIP.md` and `.watchkeeper/local/` are always local.

## What you get

- `OWNERSHIP.md` - one row per area: owner session, status, since, last touched, branch. The first edit in an area claims it. Editing an area owned by a live session is refused with the owner's id. A session that ends with uncommitted or unpushed work leaves its rows as `orphaned-dirty` with the counts.
- `DECISIONS.md` - append-only. One dated row per decision with a basis and an optional `Supersedes`. Hooks refuse direct edits; `/watchkeeper:decide` appends. In-place edits are detected and reported.
- `AUTHORIZATION.md` - the manager's written mandate: who granted it, until when, which branches, which authors, how many merges. Delete it to revoke. Every merge records the file's hash.
- `.watchkeeper/ASSUMPTIONS.md` - every claim the verifier could not verify. A branch with open rows does not merge.
- A verification gate: changes touching SQL, formulas, thresholds, views or production config (Tier 2) cannot be pushed until an independent verifier has written a record for that exact diff. The verifier may only say `verified:` with evidence or `unverified:` with a reason. Percentages and "probably" are rejected.
- `/watchkeeper:handoff` - the morning summary: orphaned worktrees first, then open questions, decisions, manager actions, verification state, live sessions. Every number comes from the files.

## Commands

| Command | What it does |
|---|---|
| `/watchkeeper:init [--local]` | Create the files in this repository |
| `/watchkeeper:claim <area> [--takeover]` | Claim an area; takeover is recorded in DECISIONS.md |
| `/watchkeeper:release [area]` | Release when done; needs a decision entry since the last edit |
| `/watchkeeper:decide <area> "<text>" [--supersedes d-0001] [--open]` | Append a decision or an OPEN question |
| `/watchkeeper:verify` | Run the verifier on the current change |
| `/watchkeeper:manage` | One manager pass; run in its own session under `/loop 20m` |
| `/watchkeeper:handoff [--since …]` | Morning takeover summary |

The same commands exist as a CLI: `node <plugin>/bin/wk.mjs <command>`. Hooks and CLI share one implementation.

## Manager

Start a dedicated session and run `/loop 20m /watchkeeper:manage`. Without `AUTHORIZATION.md` it only reconciles the board and reports. With it, it merges PRs that are green, have no open assumptions, carry only listed authors, and target a listed branch, up to the cap, until the expiry. Write the file with:

```
node <plugin>/bin/wk.mjs authorize --by "your name" --until "2026-11-07 09:00" --branches develop --authors you,your-bot --max 5
```

## When not to use it

- One session at a time, started and finished while you watch. The board will only ever have one row.
- Teams that already run a task tracker with file-level claims and a merge bot with written rules. This duplicates that.
- Repositories where you cannot run Node in hooks.

## How it works

Hooks: `SessionStart` prints the board and recent decisions into context; `PreToolUse` on edits enforces ownership; `PostToolUse` claims and touches; `Stop` asks for a decision entry when one is owed (blocks a background session once, nudges an interactive one); `PreToolUse` on Bash gates `git push`, `gh pr create` and `gh pr merge`; `SubagentStop` validates the verifier's record; `SessionEnd` releases or orphans rows in its 1.5 second budget. A `reconcile` pass on every session start settles sessions whose heartbeat stopped.

The board lives in the repository's primary worktree so every linked worktree sees one copy. Design notes and the hook-by-hook contract: `docs/design.md`.

## Development

```
npm test                      # node --test, builds temp git repos
claude plugin validate . --strict
```

MIT.
