# Telegram agent auto-routing

When a request arrives through the Telegram channel bridge, the Agent
tool may be used automatically for read-only / analysis work — no need
to ask "launch agent X?" first. If the message names an agent, use that
one; otherwise pick whichever of this project's subagents
(medavenue-analyst, client-ppc-analyst, impeccable-family agents) fits
the task.

This does NOT extend to writes: ad edits, pushing changes to a live ad
account, git commits/pushes, or any other state-changing action still
requires the user's explicit go-ahead first, exactly as before —
auto-routing only covers picking and running an agent for read/analysis
work, never authorizing what it writes.

## Traceability for Telegram-approved changes

Any change actually applied because the user approved it through the
Telegram channel bridge must be tagged so it can be found and reverted
later if something's wrong with it:

- **Git commits**: prefix the commit subject with `[tg] `, e.g.
  `[tg] Fix Yandex callout write for CampaignX`. Find them with
  `git log --grep='^\[tg\]'` (or by author, `git log --author="Claude
  Telegram Bot"`); undo one with `git revert <sha>`.
- **"Лог правок" Google Sheet entries** (e.g. `МедАвеню - Лог правок`,
  `<Клиент> - Лог правок`): append ` [TG]` to the Статус value instead of
  the plain form, e.g. `ВНЕДРЕНО 2026-09-16 [TG]` rather than
  `ВНЕДРЕНО 2026-09-16` — so filtering that column finds every
  Telegram-originated change.

This applies regardless of which session or agent actually applies the
change — what matters is whether the approval that triggered it came
through Telegram. Changes approved directly in a terminal/IDE session
are not tagged.

## Show the diff before asking to commit or push

The permission-relay popup for a `git commit`/`git push` Bash call shows
the command itself, not the file contents that changed — approving it is
not the same as reviewing it. Before ever calling Bash for `git commit`
or `git push`, send a Telegram reply with the actual change first: run
`git diff` (or `git diff --stat` for a large change, with the full diff
for any single file the user asks about) and paste it as text, or at
minimum list every changed file with a one-line summary of what changed
in each. Only send the commit/push tool call — which will still trigger
its own permission prompt — after that diff has been shown. The user
should never be approving a commit/push blind.

## Telegram bot command menu

The bot's Telegram "☰ Меню" is configured (via `setMyCommands`) with one
slash-command per agent:

| Command | Agent |
| --- | --- |
| `/medavenue` | medavenue-analyst |
| `/client_ppc` | client-ppc-analyst |
| `/impeccable_asset` | impeccable-asset-producer |
| `/impeccable_doc` | impeccable-documenter |
| `/impeccable_review` | impeccable-finish-reviewer |
| `/impeccable_edit` | impeccable-manual-edit-applier |

When an inbound Telegram message is exactly one of these commands (no
other text), do not launch the agent to do work yet — just reply in
character as that agent with a short greeting asking what's needed, e.g.
"На связи, medavenue-analyst. Чем помочь?". Only actually invoke the
agent once the user follows up with an actual task in the next message.

## Progress updates during long Telegram tasks

Telegram's own "typing…" indicator expires after a few seconds and this
channel doesn't refresh it during a long tool-call sequence, so a
multi-minute audit can look like the bot went silent or died. Send a
short reply (via the `reply` tool) at natural checkpoints during any task
that takes more than ~30–60 seconds or runs more than a handful of tool
calls — e.g. "Смотрю кампании в Директе...", "Читаю фиды, дальше сайт..."
— so the user can tell it's still working rather than wondering if it
needs to resend the message. Don't overdo it: a few short pings over a
multi-minute task, not one per tool call.

## Error reporting in Telegram

If a tool call or task fails during Telegram-originated work, reply with
the plain-language error and a ready-to-paste diagnostic block the user
can copy straight into their terminal Claude Code session, e.g.:

> Ошибка: <what broke, in plain language>
>
> Скопируй в терминал:
> ```
> В Telegram-сессии бота упала команда: <short description of what was
> being attempted>. Ошибка: <exact error text/message>. Разберись в
> причине и почини.
> ```

Keep investigating and retrying reasonable fixes yourself first — only
surface this when you're genuinely stuck or the failure needs something
only the terminal session can do (secrets, redeploys, code changes to
this repo's tooling).

## Logging activity so the terminal session can catch up

The Telegram bridge and the user's terminal/IDE session are separate
Claude Code processes with no shared context. After anything worth
knowing about later — a question answered, a decision made, a change
applied, an error hit — write a short row to Supabase so a terminal
session can catch up without re-reading the whole conversation:

```sql
insert into telegram_activity_log (tenant_id, client_name, summary, detail)
values ('51665a3a-2b26-473d-bd9c-e98a98cacba8', '<client or null>', '<one-line summary>', '<jsonb with any useful detail>');
```

Use the Supabase tools/`SUPABASE_URL`+`SUPABASE_SERVICE_ROLE_KEY` already
in this environment. One row per meaningful thing, not per message — a
whole audit can be one row summarizing the outcome, not one per tool
call. The terminal session reads this table (ordered by `created_at
desc`) to catch up — see [[feedback_ask_about_telegram_activity_at_session_start]].

## Building a link-based preview (no Artifact tool here)

This session has no Artifact tool (that requires a claude.ai account
login; this bridge authenticates with a Console API key instead — see
[[project_telegram_channel_bridge]]). For anything that would normally be
an Artifact (a landing page draft, a report page) instead of a wall of
text, deploy it via the existing Vercel pipeline
(`apps/web/lib/tools/vercel-deploy.ts` → `deployArtifact`, needs only
`VERCEL_DEPLOY_TOKEN`, already set here) and send the resulting preview
URL in the Telegram reply.

**Always confirm with the user before deploying** — same rule as the
terminal session's own ([[feedback_preview_before_vercel_deploy]]): show
what you're about to build/describe it, get a go-ahead, then deploy.

**Keep every Telegram-originated preview under one folder**,
`landing-pages/tg-previews/<slug>/`, so they're easy to find and bulk-delete
later — the user explicitly does not want these to accumulate scattered
across the repo. Use a short descriptive slug (client name or topic +
date), not a random ID.
