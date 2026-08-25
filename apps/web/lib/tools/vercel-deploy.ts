// Tool Integration §1 — Frontend Agent's "deployment-tool". Until now the
// orchestrator passed this role an inline stub returning a hardcoded
// https://dev-placeholder.example, so a "successful" deploy Task published
// nothing and the URL in the report pointed nowhere.
//
// Vercel rather than a provider abstraction: unlike creative-generation.ts
// (where "generate an asset" has many interchangeable providers), the
// agency already runs on Vercel, and a deploy target is not a thing you
// swap per call. If a second target is ever needed, it belongs behind a
// second toolId, not behind a runtime branch here.
const API_BASE = "https://api.vercel.com";
const DEPLOY_TIMEOUT_MS = 120_000;

export function isVercelDeployConfigured(): boolean {
  return Boolean(process.env.VERCEL_DEPLOY_TOKEN);
}

export interface DeploymentResult {
  readonly url: string;
  readonly note?: string;
}

// What the model hands back as "buildArtifact" is free-form. Two shapes are
// accepted and anything else is rejected loudly rather than deployed as an
// empty site: a plain HTML string, or an explicit file map.
function toFileMap(artifact: unknown): Record<string, string> {
  if (typeof artifact === "string") return { "index.html": artifact };
  if (artifact && typeof artifact === "object") {
    const record = artifact as Record<string, unknown>;
    if (typeof record.html === "string") return { "index.html": record.html };
    if (record.files && typeof record.files === "object") {
      const entries = Object.entries(record.files as Record<string, unknown>).filter(
        ([, v]) => typeof v === "string",
      ) as Array<[string, string]>;
      if (entries.length > 0) return Object.fromEntries(entries);
    }
  }
  throw new Error(
    "deployment-tool: build artifact is neither an HTML string nor a { files: Record<string,string> } map — refusing to deploy an empty site.",
  );
}

export async function deployArtifact(artifact: unknown, projectName: string): Promise<DeploymentResult> {
  const token = process.env.VERCEL_DEPLOY_TOKEN;
  if (!token) throw new Error("VERCEL_DEPLOY_TOKEN is not set");

  const files = toFileMap(artifact);
  const teamId = process.env.VERCEL_TEAM_ID;

  const response = await fetch(`${API_BASE}/v13/deployments${teamId ? `?teamId=${teamId}` : ""}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: projectName,
      // `target` intentionally omitted — a Task-produced artifact goes to a
      // preview deployment, never straight to production. Promoting it is a
      // human decision, the same principle as every ad-platform tool here
      // creating campaigns paused rather than live.
      files: Object.entries(files).map(([file, data]) => ({ file, data })),
      projectSettings: { framework: null },
    }),
    signal: AbortSignal.timeout(DEPLOY_TIMEOUT_MS),
  });

  const data = (await response.json()) as { url?: string; error?: { message?: string } };
  if (!response.ok || !data.url) {
    throw new Error(`Vercel deployment failed: ${response.status} ${data.error?.message ?? JSON.stringify(data)}`);
  }
  return { url: `https://${data.url}` };
}
