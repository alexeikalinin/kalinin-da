// Manual cleanup CLI for stray GTM containers left behind by test runs of
// provisionContainerWithGa4Tag (see docs/03-architecture/api-application-
// layer.md's 2026-08-14 entry — the GTM API needs the separate
// tagmanager.delete.containers scope, so this never runs automatically as
// part of any agent/orchestrator flow).
//
// Always prints exactly what it found and what it did — never deletes
// silently — so you can tell "created and deleted", "never existed", or
// "found but left alone" apart from the output alone.
//
// Usage:
//   node --env-file=apps/web/.env.local apps/web/scripts/delete-gtm-container.ts GTM-XXXXXXX [--yes] [--identity=ENV_VAR_NAME]
//
// --identity picks which refresh-token env var to authenticate with
// (defaults to GOOGLE_ADS_REFRESH_TOKEN — the 1alexeikalinin1 personal
// identity all GTM test-container work has used so far). Only env vars
// already defined in this repo's .env.local can be named here — there is
// no "mables" credential wired into this codebase, so this script has no
// way to reach that account even by mistake.
import { findContainerByPublicId, deleteContainer } from "../lib/tools/google-tag-manager.ts";

function parseArgs(argv: readonly string[]): { publicId: string; skipConfirm: boolean; identityEnv: string } {
  const positional = argv.filter((a) => !a.startsWith("--"));
  const publicId = positional[0];
  if (!publicId || !/^GTM-[A-Z0-9]+$/.test(publicId)) {
    console.error("Usage: delete-gtm-container.ts GTM-XXXXXXX [--yes] [--identity=ENV_VAR_NAME]");
    process.exit(1);
  }
  const skipConfirm = argv.includes("--yes");
  const identityArg = argv.find((a) => a.startsWith("--identity="));
  const identityEnv = identityArg ? identityArg.slice("--identity=".length) : "GOOGLE_ADS_REFRESH_TOKEN";
  return { publicId, skipConfirm, identityEnv };
}

async function confirm(question: string): Promise<boolean> {
  const readline = await import("node:readline/promises");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(question);
  rl.close();
  return answer.trim().toLowerCase() === "yes";
}

async function main(): Promise<void> {
  const { publicId, skipConfirm, identityEnv } = parseArgs(process.argv.slice(2));

  console.log(`[gtm-delete] identity env var: ${identityEnv}`);
  console.log(`[gtm-delete] looking up ${publicId}...`);

  const match = await findContainerByPublicId(publicId, identityEnv);
  if (!match) {
    console.log(`[gtm-delete] NOT FOUND — no container with public id ${publicId} is visible to this identity. Nothing to delete, nothing was touched.`);
    return;
  }

  console.log(`[gtm-delete] FOUND — accountId=${match.accountId} containerId=${match.containerId} publicId=${publicId}`);

  if (!skipConfirm) {
    const ok = await confirm(`[gtm-delete] Type "yes" to permanently delete this container (irreversible): `);
    if (!ok) {
      console.log("[gtm-delete] ABORTED — confirmation not given. Container left untouched.");
      return;
    }
  }

  await deleteContainer(match.accountId, match.containerId, identityEnv);
  console.log(`[gtm-delete] DELETED — ${publicId} (accountId=${match.accountId} containerId=${match.containerId}) has been permanently removed.`);
}

main().catch((error) => {
  console.error(`[gtm-delete] FAILED — ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
