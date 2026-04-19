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

# --- Install deps ---
for d in reliability safety session observability; do
  (cd "$TMP_DIR/gmui-$d" && npm install)
done

# --- Keep the Mac awake for the duration ---
caffeinate -i -s &
echo $! > "$TMP_DIR/caffeinate.pid"
echo "caffeinate pid: $(cat "$TMP_DIR/caffeinate.pid")"

# --- Launch all four in parallel, headless, logging to files ---

( cd "$TMP_DIR/gmui-reliability" && \
  claude -p --dangerously-skip-permissions \
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
  claude -p --dangerously-skip-permissions \
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
  claude -p --dangerously-skip-permissions \
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
  claude -p --dangerously-skip-permissions \
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
echo "Watch progress:   tail -f $TMP_DIR/*.log"
echo "Block until done: wait"
echo "Kill keep-awake:  kill \$(cat $TMP_DIR/caffeinate.pid)"
