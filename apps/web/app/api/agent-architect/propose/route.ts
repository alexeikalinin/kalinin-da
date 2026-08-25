import { NextResponse } from "next/server";
import { asProjectId, asRoleId, asTaskId, createInvocationContext, type RoleId } from "@ama/agent-framework";
import { createAgentArchitect, prepareAgentArchitectInvocation } from "@ama/agent-agent-architect";
import { OWNER_TENANT_ID, getSingletons } from "../../../../lib/singletons.ts";
import { AVAILABLE_ROLE_IDS } from "../../../../lib/orchestrator.ts";
import { realAgentArchitect } from "../../../../lib/real-models.ts";
import { isAnthropicConfigured } from "../../../../lib/anthropic.ts";

// Agent Framework §4a — Agent Architect is a service role, not a conveyor
// role: it is deliberately NOT a node in any Project's graph, so it has no
// case in orchestrator.ts's runNode switch. It was previously not reachable
// at all (the 2026-08-21 audit found the package absent from apps/web's
// dependencies entirely). This endpoint is its entry point, mirroring how
// Reflection is reached from finalize rather than from the graph.
//
// Proposes only. §4a is explicit that registering or activating a role is a
// separate human step, so nothing here writes the proposal anywhere — it is
// returned for a person to act on.
export async function POST(request: Request) {
  if (!isAnthropicConfigured()) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not configured — Agent Architect has no fake counterpart, it is model-only." },
      { status: 503 },
    );
  }

  const { roleDescription } = (await request.json()) as { roleDescription?: string };
  if (!roleDescription?.trim()) {
    return NextResponse.json({ error: "roleDescription is required" }, { status: 400 });
  }

  const { store, registry, credentials, catalog } = getSingletons();

  // A service role has no Project, but InvocationContext requires ids —
  // these are synthetic and never persisted, since the agent declares zero
  // memory levels and never writes (verified in its own tests).
  const context = createInvocationContext({
    tenantId: OWNER_TENANT_ID,
    projectId: asProjectId("agent-architect-service"),
    taskId: asTaskId(`architect-${Date.now()}`),
    roleId: asRoleId("agent-architect"),
    executionTier: "standard",
    approvalLevel: "output-only",
  });

  const { agentInput } = prepareAgentArchitectInvocation({
    store,
    registry,
    credentials,
    catalog,
    template: {
      roleId: context.roleId,
      version: 1,
      purpose: "Agent Architect",
      responsibility: "Только предложение спецификации роли",
    },
    context,
    taskDescription: "Предложить спецификацию новой роли по контракту Agent Framework.",
    roleDescription,
    existingRoleIds: AVAILABLE_ROLE_IDS as readonly RoleId[],
    complexity: "complex",
    invokeTool: async () => "unused",
  });

  const output = await createAgentArchitect(realAgentArchitect).invoke(agentInput);
  if (output.status !== "success") {
    const message = output.status === "failed" ? output.error.message : output.reason;
    return NextResponse.json({ error: message }, { status: 502 });
  }

  return NextResponse.json({ proposal: output.result, decisions: output.decisions });
}
