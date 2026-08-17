import type {
  ApprovalLevel,
  ExecutionTier,
  ProjectId,
} from "@ama/agent-framework";
import type { GraphState, PlanStatus, WorkflowGraph } from "@ama/workflow-engine";
import type { ProjectOutput } from "@ama/agent-report-generator";

// Split out of orchestrator.ts (2026-08-17) so lib/workflows/execute-project.ts
// (a Vercel Workflow DevKit "use workflow" module) can read/write Project
// state without statically importing orchestrator.ts — that file transitively
// pulls in real-tools.ts/real-models.ts, which use Node.js built-ins
// (child_process, etc.) at module scope. Workflow DevKit's compiler
// statically rejects ANY Node.js module reachable from a "use workflow"
// file's import graph, even inside functions the workflow itself never
// calls — so this file must stay free of anything beyond plain types, a
// Map, and object literals. Everything here is otherwise unchanged from
// what used to live directly in orchestrator.ts.

export interface ProjectInput {
  readonly siteUrl: string;
  readonly businessDescription: string;
  readonly product: string;
  readonly marketingTask: string;
  // Per-client integration ids — API/Application Layer §2, decision
  // 2026-08-13: real Google Ads/GTM/GA4 access is per-client, not a single
  // global account (Tool Integration real-tools.ts falls back to the
  // agency's own sandbox account when a project doesn't supply these).
  readonly googleAdsCustomerId?: string;
  readonly gtmAccountId?: string;
  readonly gaAccountId?: string;
  readonly yandexClientLogin?: string;
  readonly metaAdAccountId?: string;
}

export interface ProjectRecord {
  readonly projectId: ProjectId;
  readonly input: ProjectInput;
  readonly approvalLevel: ApprovalLevel;
  readonly executionTier: ExecutionTier;
  planStatus: PlanStatus;
  graph?: WorkflowGraph;
  graphState?: GraphState;
  output?: ProjectOutput;
  planSummary?: string;
  rejectionComments: string[];
  reworkComments: string[];
  createdAt: number;
  // Set once a Workflow DevKit run is started for this Project (see
  // lib/workflows/execute-project.ts) — purely for debugging/observability
  // (`npx workflow inspect run <id>`); the app's own polling contract
  // (GET /api/projects/[id]) never reads this, only graphState/planStatus.
  workflowRunId?: string;
}

const globalForProjects = globalThis as unknown as { __amaProjects__?: Map<string, ProjectRecord> };
export function projectsMap(): Map<string, ProjectRecord> {
  if (!globalForProjects.__amaProjects__) globalForProjects.__amaProjects__ = new Map();
  return globalForProjects.__amaProjects__;
}

export function getProject(projectId: string): ProjectRecord | undefined {
  return projectsMap().get(projectId);
}

export function listProjects(): readonly ProjectRecord[] {
  return [...projectsMap().values()];
}

// Which memory level + key each role writes its result under (see each
// role's own source for the write call this mirrors). Needed by both
// orchestrator.ts's runNode dispatch and execute-project.ts's success
// handling (archiving task-level output, reading report-generator's final
// output back out of project memory).
export const ROLE_OUTPUT: Record<string, { level: "task" | "project"; key: string }> = {
  research: { level: "task", key: "findings" },
  seo: { level: "task", key: "seo-recommendations" },
  ppc: { level: "task", key: "campaign-summary" },
  "media-buyer": { level: "project", key: "media-budget-plan" },
  ux: { level: "project", key: "ux-plan" },
  "ui-designer": { level: "task", key: "ui-design" },
  copywriter: { level: "task", key: "copy-draft" },
  frontend: { level: "task", key: "deployment" },
  analytics: { level: "project", key: "analytics-report" },
  qa: { level: "project", key: "qa-verdict" },
  "report-generator": { level: "project", key: "project-output" },
};

export function relativeProjectMemoryKey(roleId: string, taskId: string): string {
  const spec = ROLE_OUTPUT[roleId];
  if (!spec) throw new Error(`Unknown role output convention for "${roleId}"`);
  return spec.level === "task" ? `${taskId}:${spec.key}` : spec.key;
}
