import { test } from "node:test";
import assert from "node:assert/strict";
import { asRoleId, asTenantId } from "@ama/agent-framework";
import { MemoryStore, type Actor } from "@ama/memory";
import { recordObservation } from "./record.ts";
import { findRelevantLessons } from "./query.ts";

function reflection(tenant: string): Actor {
  return { kind: "reflection", tenantId: asTenantId(tenant) };
}

// Learning System §3 — the VK Ads/B2B example: a single bad result must not
// immediately look like a rule; three does.
test("a single observation is not yet a pattern", () => {
  const store = new MemoryStore();
  const actor = reflection("tenant-a");

  const lesson = recordObservation(store, actor, asTenantId("tenant-a"), "lesson-1", {
    situation: "VK Ads campaign for a B2B client underperformed",
    outcome: "problem",
    conclusion: "VK Ads underperforms for B2B",
    roleId: asRoleId("ppc"),
    groupKey: "vk-ads-b2b-effectiveness",
  });

  assert.equal(lesson.confidence, "observation");
});

test("the third similar observation becomes a pattern (Learning System §3 example)", () => {
  const store = new MemoryStore();
  const actor = reflection("tenant-a");
  const base = {
    situation: "VK Ads campaign for a B2B client underperformed",
    outcome: "problem" as const,
    conclusion: "VK Ads underperforms for B2B",
    roleId: asRoleId("ppc"),
    groupKey: "vk-ads-b2b-effectiveness",
  };

  const first = recordObservation(store, actor, asTenantId("tenant-a"), "lesson-1", base);
  const second = recordObservation(store, actor, asTenantId("tenant-a"), "lesson-2", base);
  const third = recordObservation(store, actor, asTenantId("tenant-a"), "lesson-3", base);

  assert.equal(first.confidence, "observation");
  assert.equal(second.confidence, "observation");
  assert.equal(third.confidence, "pattern");
});

test("PPC Agent sees relevant lessons, patterns surfaced first (Learning System §2)", () => {
  const store = new MemoryStore();
  const actor = reflection("tenant-a");
  const tenantId = asTenantId("tenant-a");

  recordObservation(store, actor, tenantId, "l1", {
    situation: "one-off issue",
    outcome: "problem",
    conclusion: "minor, ignore",
    roleId: asRoleId("ppc"),
    groupKey: "misc",
  });
  for (let i = 0; i < 3; i++) {
    recordObservation(store, actor, tenantId, `pattern-${i}`, {
      situation: "VK Ads B2B underperforms",
      outcome: "problem",
      conclusion: "avoid VK Ads for B2B",
      roleId: asRoleId("ppc"),
      groupKey: "vk-ads-b2b-effectiveness",
    });
  }
  // Unrelated role should not show up.
  recordObservation(store, actor, tenantId, "copy-1", {
    situation: "formal tone underperformed",
    outcome: "problem",
    conclusion: "use casual tone",
    roleId: asRoleId("copywriter"),
    groupKey: "tone",
  });

  const relevant = findRelevantLessons(store, actor, asRoleId("ppc"));
  assert.equal(relevant.length, 4);
  assert.equal(relevant[0]?.confidence, "pattern");
});
