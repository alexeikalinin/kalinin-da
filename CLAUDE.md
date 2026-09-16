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
