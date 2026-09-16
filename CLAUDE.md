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
