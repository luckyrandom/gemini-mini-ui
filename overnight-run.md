# Overnight parallel Claude Code run

Run the four TODO.md sections in parallel, each in its own git worktree, then
merge the branches locally in the morning. No GitHub PRs — pure local merges.

## Prerequisites

- Laptop plugged in, lid open (macOS sleeps on lid close).
- `claude` CLI in PATH.
- Clean `main` (commit or stash anything pending).

## Step 1 — One-time setup

```bash
cd /Users/chenliangxu/GitHub/gemini-mini-ui

# Scratch dir for worktrees (outside the repo, not tracked)
mkdir -p ../_claude_tmp

# Optional: let the skill add read-only tool calls to the allowlist based on
# your past transcripts. Review its proposal before accepting.
claude          # inside the session: /less-permission-prompts
# Then exit claude and commit whatever it changed:
git add .claude/settings.json
git commit -m "chore: expand permission allowlist"
```

The real interrupt-prevention is `--permission-mode acceptEdits` on each
headless call below. The skill just trims read-only prompts on top.

## Step 2 — Run the launch script

Save the block below as `launch-overnight.sh` in the repo root, make it
executable (`chmod +x launch-overnight.sh`), then run it. It creates the
four worktrees, installs deps, starts `caffeinate`, and kicks off all four
headless sessions in parallel.

```bash
#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"
REPO_ROOT=$(pwd)
TMP_DIR="$REPO_ROOT/../_claude_tmp"
mkdir -p "$TMP_DIR"

# --- Worktrees ---
git worktree add "$TMP_DIR/gmui-reliability"   -b feat/error-messages
git worktree add "$TMP_DIR/gmui-safety"        -b feat/policy-control
git worktree add "$TMP_DIR/gmui-session"       -b feat/session-mgmt
git worktree add "$TMP_DIR/gmui-observability" -b feat/debug-panel

# --- Install deps (swap bun for npm/pnpm if needed) ---
for d in reliability safety session observability; do
  (cd "$TMP_DIR/gmui-$d" && bun install)
done

# --- Keep the Mac awake for the duration ---
caffeinate -i -s &
echo $! > "$TMP_DIR/caffeinate.pid"
echo "caffeinate pid: $(cat "$TMP_DIR/caffeinate.pid")"

# --- Launch all four in parallel, headless, logging to files ---

( cd "$TMP_DIR/gmui-reliability" && \
  claude -p --permission-mode acceptEdits \
  "Implement the Reliability section of TODO.md.
   Replace bare 'Stream error / network error' with a typed error surface
   (network / model / tool) rendered as an inline system bubble with a
   Retry affordance. Scope: streaming layer + chat bubble renderer only.
   Do not touch session list, composer, or tool-execution policy.
   Run typecheck and tests; do not declare done until green.
   Commit incrementally on this branch. When done, print a short summary:
   branch name, files changed, how to run the new feature locally, and any
   follow-ups. Do not push and do not open a PR." \
) > "$TMP_DIR/reliability.log" 2>&1 &

( cd "$TMP_DIR/gmui-safety" && \
  claude -p --permission-mode acceptEdits \
  "Implement the Safety section of TODO.md.
   Add an approval gate before destructive/write tool calls execute.
   v1 scope: prompt-per-call for write tools via a modal, no cross-turn
   memory of approvals. Surface the pending-tool state clearly in the UI.
   Scope: tool-execution layer + new approval modal component.
   Do not touch the streaming error path or session management.
   Run typecheck and tests; do not declare done until green.
   Commit incrementally. When done, print a short summary: branch name,
   files changed, how to run the feature locally, any follow-ups.
   Do not push and do not open a PR." \
) > "$TMP_DIR/safety.log" 2>&1 &

( cd "$TMP_DIR/gmui-session" && \
  claude -p --permission-mode acceptEdits \
  "Implement the Session management section of TODO.md in two commits on this branch.
   (a) Fork chat to a new session: per-message 'fork from here' action creates
       a brand-new session seeded with messages up to and including that point.
       Original session untouched.
   (b) Resend last turn with different model / context: mutates the current
       session in place — user picks a different model and regenerates the
       last assistant turn. Distinct from fork.
   Do (a) first, commit, verify typecheck + tests pass, then (b), commit again.
   Scope: session list, message list, composer, and session store only.
   Do not touch streaming internals, tool-execution policy, or the debug panel.
   When done, print a short summary: branch name, both commit SHAs, files
   changed, and how to try each feature. Do not push and do not open a PR." \
) > "$TMP_DIR/session.log" 2>&1 &

( cd "$TMP_DIR/gmui-observability" && \
  claude -p --permission-mode acceptEdits \
  "Implement the Observability section of TODO.md.
   Add a debug drawer toggled from the session header. Show, for the current
   session: the request payload sent to the model, streamed response chunks,
   tool calls issued, and tool outputs received.
   Scope: new drawer component + one wiring point in the session view.
   Do not modify streaming internals or tool-execution logic — read-only view.
   Run typecheck and tests; do not declare done until green.
   Commit incrementally. When done, print a short summary: branch name, files
   changed, how to open the drawer, and any follow-ups. Do not push and do
   not open a PR." \
) > "$TMP_DIR/observability.log" 2>&1 &

echo
echo "All four sessions launched. Logs:"
ls -1 "$TMP_DIR"/*.log
echo
echo "Watch progress:  tail -f $TMP_DIR/*.log"
echo "Block until done: wait"
echo "Kill keep-awake: kill \$(cat $TMP_DIR/caffeinate.pid)"
```

Run it:

```bash
chmod +x launch-overnight.sh
./launch-overnight.sh
```

## Step 3 — Monitor

```bash
jobs                                 # should list 4 running
tail -f ../_claude_tmp/*.log         # Ctrl-C stops the tail, not the jobs
wait                                 # blocks until all 4 finish
```

## Step 4 — Review and merge locally in the morning

```bash
kill $(cat ../_claude_tmp/caffeinate.pid) 2>/dev/null

cd /Users/chenliangxu/GitHub/gemini-mini-ui
git checkout main

# Skim each log for the summary the session printed
tail -n 60 ../_claude_tmp/reliability.log
tail -n 60 ../_claude_tmp/safety.log
tail -n 60 ../_claude_tmp/session.log
tail -n 60 ../_claude_tmp/observability.log

# Review each branch
for b in feat/error-messages feat/policy-control feat/session-mgmt feat/debug-panel; do
  echo "=== $b ==="
  git log --oneline main..$b
done

# Diff a branch before merging
git diff main..feat/debug-panel

# Merge the ones you like (--no-ff keeps the branch boundary visible)
git merge --no-ff feat/debug-panel
git merge --no-ff feat/error-messages
# ...etc.
```

**Merge order tip:** Reliability and Safety both touch the streaming /
tool-exec layer. Merge one first, then rebase the other onto main before
merging:

```bash
git checkout feat/policy-control
git rebase main
# resolve conflicts if any
git checkout main
git merge --no-ff feat/policy-control
```

## Step 5 — Cleanup

```bash
# For each branch you merged:
git worktree remove ../_claude_tmp/gmui-reliability
git branch -d feat/error-messages

# For anything you decided to discard:
git worktree remove --force ../_claude_tmp/gmui-<section>
git branch -D feat/<branch>

# Or nuke everything (only if no unmerged work remains):
rm -rf ../_claude_tmp
git worktree prune
```

## Troubleshooting

- **A session hung.** `ps aux | grep claude` to find it, `kill <pid>`. The
  log file has the last output.
- **Tests never passed.** Don't merge — just discard the branch.
- **Merge conflicts on Reliability vs. Safety.** Expected. Rebase the second
  one onto main after the first merges.
- **`bun install` failed in a worktree.** Each worktree needs its own
  `node_modules`. Re-run it in that directory before re-launching.
