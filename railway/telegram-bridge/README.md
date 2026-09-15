# Telegram bridge for Claude Code (Railway)

Runs this Claude Code session's Telegram channel 24/7 on Railway, independent of
whether your laptop is on. Uses the official Anthropic Channels feature +
`plugin:telegram@claude-plugins-official` (research preview), with **permission
relay** — Claude asks for approval, the prompt is forwarded to Telegram, you
approve/deny there. No `--dangerously-skip-permissions` is used anywhere in this
setup.

## What you need before deploying

1. A Railway account, logged in and with GitHub connected (you're doing this now).
2. `ANTHROPIC_API_KEY` — already in `apps/web/.env.local` (Console key named
   "Kalinin Digital Agency").
3. `TELEGRAM_BOT_TOKEN` — already in `apps/web/.env.local` (from BotFather).
4. Optional but recommended: a GitHub **Personal Access Token** (classic, scope
   `repo`) so the bot can `git push` changes back to `alexeikalinin/kalinin-da`.
   Without it, the bot can still edit files inside the container, but those
   edits won't reach your local checkout automatically.

## Deploy steps

1. In Railway: **New Project → Deploy from GitHub repo** → select
   `alexeikalinin/kalinin-da`.
2. In the new service's **Settings → Build**:
   - **Root Directory**: leave as repo root (`/`)
   - **Dockerfile Path**: `railway/telegram-bridge/Dockerfile`
   - Builder: Dockerfile (should auto-detect once the path is set)
3. In **Settings → Variables**, add:
   - `ANTHROPIC_API_KEY` = (value from `apps/web/.env.local`)
   - `TELEGRAM_BOT_TOKEN` = (value from `apps/web/.env.local`)
   - `GITHUB_TOKEN` = your PAT (optional, see above)
   - `GIT_USER_NAME` = `Claude Telegram Bot` (or whatever you prefer)
   - `GIT_USER_EMAIL` = an email for the bot's commits
4. Deploy. Watch the build logs — first boot installs Bun + the Claude Code
   CLI + the Telegram plugin, then starts a `tmux` session running
   `claude --channels plugin:telegram@claude-plugins-official` on a loop
   (auto-restarts if it ever exits).

## One-time pairing (can't be scripted — this is intentional, it's the security gate)

You need the [Railway CLI](https://docs.railway.com/guides/cli) locally for this part:

```bash
npm i -g @railway/cli
railway login
railway link            # pick this project/service
railway ssh -- tmux attach -t claude
```

Then, in Telegram:
1. Open a DM with your bot and send any message.
2. It replies with a 6-character pairing code.

Back in the attached tmux session (still inside `railway run`):
```
/telegram:access pair <code>
/telegram:access policy allowlist
```
The second command locks the bot down so only you can message it. Detach from
tmux without killing it: `Ctrl+B` then `D`.

From here on, message the bot in Telegram like normal. When Claude wants to run
a tool that needs approval, you'll get the same prompt in Telegram with buttons
— approve or deny there, or in this same tmux session if you're attached.

## If something goes wrong

- `railway logs` — shows the piped tmux output (`/tmp/claude-session.log`).
- `railway ssh -- claude plugin list` — confirms the Telegram plugin installed.
- `railway ssh -- tmux attach -t claude` — attach to the live session directly,
  same as during pairing, for any manual troubleshooting.
- Bot not responding: confirm `claude --channels plugin:telegram@claude-plugins-official`
  is the process actually running (`railway ssh -- tmux attach -t claude` and look
  at the top of the pane for the channels startup banner).
