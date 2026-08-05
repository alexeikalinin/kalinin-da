import { test } from "node:test";
import assert from "node:assert/strict";
import { asRoleId, asTenantId } from "@ama/agent-framework";
import type { Actor } from "@ama/memory";
import { RoleTemplateRegistry } from "./template-registry.ts";

function approver(): Actor {
  return { kind: "approver", tenantId: asTenantId("tenant-a") };
}
function agent(): Actor {
  return { kind: "agent", tenantId: asTenantId("tenant-a") };
}

test("proposed versions accumulate history without becoming active automatically", () => {
  const registry = new RoleTemplateRegistry();
  const roleId = asRoleId("ppc");

  registry.propose(roleId, "Настроить кампании.", "Только настройка.");
  registry.propose(roleId, "Настроить и запустить кампании.", "Только настройка.");

  assert.equal(registry.history(roleId).length, 2);
  assert.equal(registry.getActive(roleId), undefined);
});

test("only an approver can publish a version as active (§4)", () => {
  const registry = new RoleTemplateRegistry();
  const roleId = asRoleId("ppc");
  const v1 = registry.propose(roleId, "Настроить кампании.", "Только настройка.");

  assert.throws(() => registry.publish(agent(), roleId, v1.version));

  registry.publish(approver(), roleId, v1.version);
  assert.equal(registry.getActive(roleId)?.version, v1.version);
});

test("publishing a new version keeps the old one in history (§3, needed for Reflection comparisons)", () => {
  const registry = new RoleTemplateRegistry();
  const roleId = asRoleId("copywriter");
  const v1 = registry.propose(roleId, "Писать тексты.", "Только тексты.");
  const v2 = registry.propose(roleId, "Писать разговорные тексты.", "Только тексты.");

  registry.publish(approver(), roleId, v1.version);
  registry.publish(approver(), roleId, v2.version);

  assert.equal(registry.getActive(roleId)?.version, v2.version);
  assert.equal(registry.history(roleId).length, 2);
});
