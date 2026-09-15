#!/bin/bash
set -euo pipefail

: "${ANTHROPIC_API_KEY:?ANTHROPIC_API_KEY env var is required (Railway service variable)}"
: "${TELEGRAM_BOT_TOKEN:?TELEGRAM_BOT_TOKEN env var is required (Railway service variable)}"

git config --global user.name "${GIT_USER_NAME:-Claude Telegram Bot}"
git config --global user.email "${GIT_USER_EMAIL:-bot@kalinin-da.local}"
git config --global --add safe.directory /repo

# Optional: lets the bot push commits back to GitHub. Without this, edits stay
# inside the container only (fine for read/ask-only use, not for round-tripping
# fixes back to your local checkout).
if [ -n "${GITHUB_TOKEN:-}" ]; then
  git remote set-url origin "https://${GITHUB_TOKEN}@github.com/alexeikalinin/kalinin-da.git"
fi

mkdir -p "$HOME/.claude"
cat > "$HOME/.claude/settings.json" <<'JSON'
{
  "extraKnownMarketplaces": {
    "claude-plugins-official": {
      "source": { "source": "github", "repo": "anthropics/claude-plugins-official" }
    }
  },
  "enabledPlugins": ["telegram@claude-plugins-official"]
}
JSON

# No standalone `claude plugin install` here: the official marketplace is only
# auto-registered by a normal interactive launch, and a bare `claude plugin
# install` as the container's very first-ever invocation fails with "not found
# in marketplace" because that registration hasn't happened yet. Declaring the
# plugin in enabledPlugins above is enough — the long-running `claude
# --channels` session below picks it up once its own interactive startup runs.

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
  tmux send-keys -t claude Enter 2>/dev/null || true   # any trailing dialog
) &

exec tail -f "$LOG"
