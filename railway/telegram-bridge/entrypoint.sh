#!/bin/bash
set -euo pipefail

: "${ANTHROPIC_API_KEY:?ANTHROPIC_API_KEY env var is required (Railway service variable)}"
: "${TELEGRAM_BOT_TOKEN:?TELEGRAM_BOT_TOKEN env var is required (Railway service variable)}"

git config --global user.name "${GIT_USER_NAME:-Claude Telegram Bot}"
git config --global user.email "${GIT_USER_EMAIL:-bot@kalinin-da.local}"
git config --global --add safe.directory /repo

# The Dockerfile's `COPY . .` gives /repo a plain file snapshot with no `.git`
# directory (Railway's build context doesn't include it), so git push/pull
# fail there with "not a git repository" — confirmed live 2026-09-16. Replace
# it with a real clone whenever a token is available, so git operations
# actually work. Without GITHUB_TOKEN, fall back to the static snapshot
# (read/edit-only inside the container, no push).
if [ -n "${GITHUB_TOKEN:-}" ]; then
  echo "[entrypoint] cloning a real git checkout for push/pull support..."
  rm -rf /repo-git-clone
  if git clone --quiet "https://${GITHUB_TOKEN}@github.com/alexeikalinin/kalinin-da.git" /repo-git-clone; then
    rm -rf /repo
    mv /repo-git-clone /repo
  else
    echo "[entrypoint] git clone failed — falling back to the static snapshot from the Docker build (no push)"
  fi
fi

mkdir -p "$HOME/.claude"
cat > "$HOME/.claude/settings.json" <<'JSON'
{
  "extraKnownMarketplaces": {
    "claude-plugins-official": {
      "source": { "source": "github", "repo": "anthropics/claude-plugins-official" }
    }
  },
  "enabledPlugins": { "telegram@claude-plugins-official": true }
}
JSON

# enabledPlugins above only *declares* the plugin — it does not fetch and
# install it (confirmed live: `claude plugin list` said "No plugins
# installed" even with enabledPlugins set). A real `claude plugin install`
# is required, but it can only succeed AFTER the official marketplace has
# been registered — and that registration itself only happens once a normal
# interactive `claude` session completes its first-run onboarding.
# extraKnownMarketplaces above does not substitute for this: confirmed live
# that `claude plugin install` still fails with "not found in marketplace"
# when run before onboarding, even with extraKnownMarketplaces set. So the
# install call is deferred below, after the onboarding auto-accept sequence.

mkdir -p "$HOME/.claude/channels/telegram"
printf 'TELEGRAM_BOT_TOKEN=%s\n' "$TELEGRAM_BOT_TOKEN" > "$HOME/.claude/channels/telegram/.env"

LOG=/tmp/claude-session.log
touch "$LOG"

# Run Claude Code inside tmux so it gets a real PTY (Railway containers have none
# by default) and so a human can attach later for the one-time Telegram pairing
# step via: railway run tmux attach -t claude
tmux kill-session -t claude 2>/dev/null || true
tmux new-session -d -s claude -x 220 -y 50 \
  "cd /repo && while true; do claude --channels plugin:telegram@claude-plugins-official; echo '[entrypoint] claude exited, restarting in 5s'; sleep 5; done"
tmux pipe-pane -o -t claude "cat >> $LOG"

# First-ever launch in a fresh container shows Claude Code's interactive
# first-run wizard and blocks waiting for a keypress nobody is attached to
# give it. Screens observed, in order, and their non-default traps:
#   1. Theme picker — a default is already highlighted, plain Enter accepts it.
#   2. "Detected a custom API key ... use this API key?" — defaults to
#      "No (recommended)", which pushes into a browser OAuth login flow that
#      can't work headlessly. Move up to "Yes" before confirming.
#   3. Security notes — plain "Press Enter to continue".
#   4. Folder trust check — defaults to "No, exit" (would make Claude quit
#      immediately, and the while-loop would just hit this same screen
#      forever). Move up to "Yes, I trust this folder" before confirming.
#   5. This repo's committed .mcp.json declares project MCP servers
#      (design-tooling, unrelated to the Telegram bridge) — Claude Code asks
#      whether to enable them. Reject with Escape to keep this bot's
#      permission surface limited to what the bridge actually needs.
# Harmless no-op on later restarts once onboarding is already complete
# (settings persist under ~/.claude for the life of this container).
(
  sleep 4
  tmux send-keys -t claude Enter        # theme picker: accept default
  sleep 3
  tmux send-keys -t claude Up           # API key prompt: move off "No" ...
  tmux send-keys -t claude Enter        # ... onto "Yes", then confirm
  sleep 3
  tmux send-keys -t claude Enter        # security notes: continue
  sleep 2
  tmux send-keys -t claude Up           # folder trust: move off "No, exit" ...
  tmux send-keys -t claude Enter        # ... onto "Yes, I trust this folder"
  sleep 3
  tmux send-keys -t claude Escape 2>/dev/null || true   # reject project MCP servers, if asked
  sleep 2

  # Only now — after onboarding registered the official marketplace — can the
  # plugin actually install. Skip entirely if a previous boot already did this
  # (persists under ~/.claude for the life of this container).
  if ! claude plugin list 2>/dev/null | grep -q "telegram@claude-plugins-official"; then
    claude plugin install telegram@claude-plugins-official --scope user --yes \
      || echo "[entrypoint] plugin install did not confirm success — check with: railway ssh -- claude plugin list"
    # The already-running interactive session printed "plugin not installed"
    # at its own startup and won't notice the plugin appearing mid-session —
    # restart it so the next launch picks it up.
    tmux kill-session -t claude 2>/dev/null || true
    tmux new-session -d -s claude -x 220 -y 50 \
      "cd /repo && while true; do claude --channels plugin:telegram@claude-plugins-official; echo '[entrypoint] claude exited, restarting in 5s'; sleep 5; done"
    tmux pipe-pane -o -t claude "cat >> $LOG"
    # Theme/trust/API-key choices persist across launches, but the project
    # MCP servers prompt does not — this second launch asks again.
    sleep 4
    tmux send-keys -t claude Escape 2>/dev/null || true
  fi
) &

exec tail -f "$LOG"
