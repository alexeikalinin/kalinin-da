import { test } from "node:test";
import assert from "node:assert/strict";
import { asTenantId } from "@ama/agent-framework";
import { MemoryStore, type Actor } from "@ama/memory";
import { reviewProposal } from "./review.ts";

function agent(tenant: string): Actor {
  return { kind: "agent", tenantId: asTenantId(tenant) };
}
function system(tenant: string): Actor {
  return { kind: "system", tenantId: asTenantId(tenant) };
}
function approver(tenant: string): Actor {
  return { kind: "approver", tenantId: asTenantId(tenant) };
}

// Knowledge Base §4 — the reference scenario example, almost verbatim:
// a minor finding (account exists) gets auto-confirmed; a reputationally
// significant one (negative reviews) waits for the user.

test("a minor finding is auto-confirmed by the system, without asking the user", () => {
  const store = new MemoryStore();
  const tenantId = asTenantId("tenant-a");
  const proposal = store.proposeFact(
    agent("tenant-a"),
    { level: "client_kb", tenantId, key: "google-ads-account" },
    "existing account with campaign history",
  );

  const outcome = reviewProposal(store, system("tenant-a"), proposal, "minor");

  assert.equal(outcome.significance, "minor");
  assert.equal(outcome.resolution?.outcome, "confirmed");
  assert.equal(
    store.read(agent("tenant-a"), { level: "client_kb", tenantId, key: "google-ads-account" }),
    "existing account with campaign history",
  );
});

test("a significant finding is left pending — it does not become a fact until a human approver confirms it", () => {
  const store = new MemoryStore();
  const tenantId = asTenantId("tenant-a");
  const proposal = store.proposeFact(
    agent("tenant-a"),
    { level: "client_kb", tenantId, key: "past-campaign-reception" },
    "previous campaigns got negative audience reviews",
  );

  const outcome = reviewProposal(store, system("tenant-a"), proposal, "significant");

  assert.equal(outcome.significance, "significant");
  assert.equal(outcome.resolution, undefined);
  assert.equal(
    store.read(agent("tenant-a"), {
      level: "client_kb",
      tenantId,
      key: "past-campaign-reception",
    }),
    undefined,
  );
});

test("a significant finding becomes a fact once the human approver confirms it directly", () => {
  const store = new MemoryStore();
  const tenantId = asTenantId("tenant-a");
  const proposal = store.proposeFact(
    agent("tenant-a"),
    { level: "client_kb", tenantId, key: "past-campaign-reception" },
    "previous campaigns got negative audience reviews",
  );
  reviewProposal(store, system("tenant-a"), proposal, "significant");

  store.confirmProposal(approver("tenant-a"), proposal.id);

  assert.equal(
    store.read(agent("tenant-a"), {
      level: "client_kb",
      tenantId,
      key: "past-campaign-reception",
    }),
    "previous campaigns got negative audience reviews",
  );
});
