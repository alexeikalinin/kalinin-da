---
name: sync-keys
description: Use whenever the user gives you an API key, token, or secret to save, or asks you to check/find/restore/audit a credential in this project. Also use proactively any time you have just written a key into one .env file — before ending the turn, mirror it everywhere else it belongs. Keeps every .env* file in this repo and the reference_api_keys.md memory in sync so no key is ever "lost" or only half-saved.
user-invocable: true
argument-hint: "[KEY=value ...] | audit"
---

This project has exactly two env files as of 2026-09-15 (re-run the discovery step below — a new app/package may add more):

- `/.env.local` (repo root)
- `/apps/web/.env.local`

Both are gitignored (never remove that gitignore coverage). They are meant to hold the **same full set of keys** — this repo does not split secrets by app. Treat any key present in one but missing from the other as a bug to fix immediately, not a note to leave for later.

## When the user hands you a new key/token

1. Discover every env file: `find . -name ".env*" -not -path "*/node_modules/*" -not -path "*/.git/*"`.
2. Read the target file(s) with Read (required before Edit).
3. Add/update the `KEY="value"` line (quote the value unless it's a plain alphanumeric token like existing unquoted entries — match the quoting style already used in that file for similar keys).
4. Immediately mirror the same `KEY=value` line into every other env file found in step 1. Do not leave any file behind — an env file with only some of the keys is exactly the "lost key" failure mode this skill exists to prevent.
5. Update the memory file `reference_api_keys.md` (find it via the memory MEMORY.md index) with the key name and which files/services now have it. Do not write the raw secret value into memory — reference that it's "in .env.local (root + apps/web), synced" plus any other place it's wired (Vercel env, Railway, etc.) if you set that up too.
6. Confirm to the user in one line what was saved and everywhere it was mirrored to.

## When asked to audit / "do you have key X"

1. Grep all env files (not just one) before ever saying a key is missing: `grep -rn "KEY_NAME" .env.local apps/web/.env.local` (and any others found by the discovery command above).
2. If it exists in at least one file but not all, treat that as a sync bug: copy it to the files missing it (per the mirroring step above) rather than just reporting the gap.
3. Only report a key as genuinely missing if it is absent from every env file AND not resolvable via memory (reference_api_keys.md, project_keys_to_restore.md) pointing to where it lives externally (a password manager, a provider dashboard). If memory points to an external source, say so explicitly instead of "not found."
4. A value that is a placeholder (e.g. `"[SENSITIVE]"`, empty string, obviously truncated) counts as **not actually configured** — flag it by name to the user rather than silently treating the key as present. This is different from "can't find it": be precise about which failure mode it is.

## Full sync / drift check (run this whenever asked to "sync all keys" or before trusting env state for something important)

```bash
# from repo root
comm -23 <(grep -o '^[A-Z_][A-Z0-9_]*' apps/web/.env.local | sort -u) <(grep -o '^[A-Z_][A-Z0-9_]*' .env.local | sort -u)
comm -23 <(grep -o '^[A-Z_][A-Z0-9_]*' .env.local | sort -u) <(grep -o '^[A-Z_][A-Z0-9_]*' apps/web/.env.local | sort -u)
```

The first line lists keys present in `apps/web/.env.local` but missing from root `.env.local`; the second is the reverse. Any output from either command is a drift bug — fix it by copying the missing `KEY="value"` lines over, then re-run both commands until both are empty.

If a third env file is later added to the repo (new app/package), extend this same comm-based check to include it, and update the file list at the top of this skill.

## Hard rule

Never tell the user "I can't find that key" without having run the discovery + grep steps above across every env file in the repo in *this* turn. If after that it's truly nowhere and memory has no pointer to an external source, say so plainly and ask where it lives — but that's the last resort, not the first answer.
