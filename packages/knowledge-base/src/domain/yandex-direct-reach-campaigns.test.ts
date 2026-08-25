import { test } from "node:test";
import assert from "node:assert/strict";
import { asTenantId } from "@ama/agent-framework";
import { MemoryStore, type Actor } from "@ama/memory";
import {
  YANDEX_DIRECT_REACH_CAMPAIGN_ANALYTICS_FACT_KEYS,
  YANDEX_DIRECT_REACH_CAMPAIGN_FACT_KEYS,
  YANDEX_DIRECT_REACH_CAMPAIGN_FACTS,
  seedYandexDirectReachCampaignFacts,
} from "./yandex-direct-reach-campaigns.ts";

function approver(): Actor {
  return { kind: "approver", tenantId: asTenantId("tenant-a") };
}

test("seedYandexDirectReachCampaignFacts confirms every fact into the shared Domain KB", () => {
  const store = new MemoryStore();
  const you = approver();
  const tenantId = asTenantId("tenant-a");

  const results = seedYandexDirectReachCampaignFacts(store, you, tenantId);

  assert.equal(results.length, YANDEX_DIRECT_REACH_CAMPAIGN_FACTS.length);
  assert.ok(results.every((r) => r.outcome === "confirmed"));

  for (const fact of YANDEX_DIRECT_REACH_CAMPAIGN_FACTS) {
    assert.equal(
      store.read(you, { level: "domain_kb", tenantId, key: fact.key }),
      fact.value,
    );
  }
});

test("Domain KB is shared across tenants — a different tenant's actor reads the same facts", () => {
  const store = new MemoryStore();
  seedYandexDirectReachCampaignFacts(store, approver(), asTenantId("tenant-a"));

  const otherTenant: Actor = { kind: "agent", tenantId: asTenantId("tenant-b") };
  const value = store.read(otherTenant, {
    level: "domain_kb",
    tenantId: asTenantId("tenant-b"),
    key: "yandex-direct:reach:overview",
  });

  assert.equal(typeof value, "string");
});

test("the curated Analytics key subset only names facts that actually exist", () => {
  for (const key of YANDEX_DIRECT_REACH_CAMPAIGN_ANALYTICS_FACT_KEYS) {
    assert.ok(YANDEX_DIRECT_REACH_CAMPAIGN_FACT_KEYS.includes(key), `missing fact for key "${key}"`);
  }
});
