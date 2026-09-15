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
{ "enabledPlugins": ["telegram@claude-plugins-official"] }
JSON

# Idempotent: safe to run on every boot/redeploy.
claude plugin install telegram@claude-plugins-official --scope user --yes \
  || echo "[entrypoint] plugin install did not confirm success — check with: railway run claude plugin list"

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

exec tail -f "$LOG"
