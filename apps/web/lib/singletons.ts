import { asTenantId } from "@ama/agent-framework";
import { MemoryStore, type Actor } from "@ama/memory";
import { ToolRegistry, CredentialStore } from "@ama/tools";
import { createAnthropicModelCatalog } from "@ama/cost-router";
import { attachLogSink, createEventBus } from "@ama/events";

// API/Application Layer §1 — auth deliberately simplified to a single
// tenant (Owner) on the first iteration. This is the one place that fact
// is hardcoded; everything downstream still goes through the same
// tenant-scoped isolation as a multi-tenant deployment would.
export const OWNER_TENANT_ID = asTenantId("owner");
export const APPROVER: Actor = { kind: "approver", tenantId: OWNER_TENANT_ID };
export const AGENT_ACTOR: Actor = { kind: "agent", tenantId: OWNER_TENANT_ID };

// Next.js dev mode re-evaluates route modules on every request but keeps
// the Node process alive — without stashing these on globalThis, each
// request would silently get a fresh, empty MemoryStore and "lose" every
// previously created Project. Production (a real deployment) replaces this
// whole file with real Supabase-backed persistence (Database migration
// already exists — see supabase/migrations/0001_init.sql); this is a
// dev-only convenience, not an architectural decision.
interface Singletons {
  store: MemoryStore;
  registry: ToolRegistry;
  credentials: CredentialStore;
  catalog: ReturnType<typeof createAnthropicModelCatalog>;
  bus: ReturnType<typeof createEventBus>;
  log: ReturnType<typeof attachLogSink>;
}

const globalForAma = globalThis as unknown as { __ama__?: Singletons };

function createSingletons(): Singletons {
  const store = new MemoryStore();
  const registry = new ToolRegistry();
  const credentials = new CredentialStore();
  const catalog = createAnthropicModelCatalog();
  const bus = createEventBus();
  const log = attachLogSink(bus);

  // Tool Integration, Open Question #1 — registering a tool type requires
  // an approver. These are the tool ids every reference-conveyor role
  // declares; credentials are placeholders (no real provider accounts —
  // see Roadmap's "какие реальные аккаунты нужны").
  const toolIds = [
    "site-reader",
    "web-search",
    "seo-service",
    "google-ads",
    "vk-ads",
    "yandex-direct",
    "google-analytics",
    "yandex-metrika",
    "design-tool",
    "deployment-tool",
  ];
  for (const toolId of toolIds) {
    registry.register(APPROVER, { toolId, displayName: toolId });
    credentials.issue(APPROVER, toolId, `dev-placeholder-token-${toolId}`);
  }

  return { store, registry, credentials, catalog, bus, log };
}

export function getSingletons(): Singletons {
  if (!globalForAma.__ama__) {
    globalForAma.__ama__ = createSingletons();
  }
  return globalForAma.__ama__;
}
