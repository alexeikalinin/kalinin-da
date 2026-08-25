import { stitch } from "@google/stitch-sdk";

// Tool Integration §1 — UI Designer Agent's "design-tool". Until now the
// orchestrator passed this role an inline stub returning `{}`, so the role
// produced mockups with no visual source material at all.
//
// Google Stitch (@google/stitch-sdk, server-side via STITCH_API_KEY) was
// chosen over v0 for this specific tool because it is the only option that
// returns a rendered screenshot *and* HTML for the same screen: a mockup a
// client can look at and approve, not just code. See backlog #26 for the
// full comparison — v0 remains the better fit for "build and deploy the
// real page", which is Frontend Agent's job (vercel-deploy.ts), not this
// role's.
//
// Known risk, stated rather than hidden: Stitch is labelled "not an
// officially supported Google product" and its API limits are
// undocumented. Callers must handle ToolUnavailableError — real-tools.ts
// degrades to a note rather than failing the Task.
const GENERATION_TIMEOUT_MS = 300_000;

// Stitch's own generated `project.generate()` does NOT forward a
// designSystem argument (verified in the SDK's project.js), so the raw tool
// is called directly — without this the design system is silently ignored
// and every screen comes back in Stitch's default look, which is exactly
// the "generic AI landing page" outcome this tool exists to avoid.
const GENERATE_TOOL = "generate_screen_from_text";

export function isStitchConfigured(): boolean {
  return Boolean(process.env.STITCH_API_KEY);
}

export interface DesignBrief {
  // What to design, in prose. Composed by the caller from the UX plan and
  // the project's own brief — this is the single biggest quality lever
  // after the design system.
  readonly brief: string;
  readonly deviceType?: "DESKTOP" | "MOBILE" | "TABLET" | "AGNOSTIC";
  readonly projectTitle: string;
  readonly brand?: BrandInput;
}

export interface BrandInput {
  readonly primaryColor?: string;
  readonly colorMode?: "LIGHT" | "DARK";
  readonly headlineFont?: string;
  readonly bodyFont?: string;
  readonly styleNotes?: string;
}

export interface DesignResult {
  readonly screenshotUrl: string;
  readonly html: string;
  readonly projectId: string;
  readonly screenId: string;
}

// The craft floor. Stitch will happily produce a competent-but-generic
// layout from a bare prompt; what separates that from studio work is an
// explicit typographic scale, restrained color, and real spacing rhythm.
// Encoding it here means every generated screen starts from the same
// standard instead of depending on how the brief happened to be worded.
function buildDesignMd(brand: BrandInput | undefined): string {
  return [
    "# Design standard",
    "",
    "## Typography",
    "- Establish a clear type scale and stay on it; no ad-hoc sizes.",
    "- Headlines get tighter letter-spacing and balanced wrapping; body text stays near 65 characters per line.",
    "- Never use more than two families: one for display, one for text.",
    "",
    "## Color",
    "- One accent, used sparingly, for the single most important action per view.",
    "- Neutrals are chosen with a slight hue bias toward the accent, never flat mid-grey.",
    "- Semantic color (success/warning/danger) stays separate from the accent.",
    "",
    "## Layout & spacing",
    "- Space with a consistent rhythm; group related elements by proximity, not by borders.",
    "- Generous whitespace over dense packing. Content column is constrained, not full-bleed text.",
    "- Real visual hierarchy: one clear focal point per screen, everything else subordinate.",
    "",
    "## What to avoid",
    "- Centered everything, evenly-weighted sections, rounded cards with an accent bar — the generic AI-landing-page look.",
    "- Decorative gradients and drop shadows used as a substitute for hierarchy.",
    "- Placeholder/lorem text: write real copy for the subject.",
    brand?.styleNotes ? `\n## Brand notes\n${brand.styleNotes}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

async function findOrCreateProject(title: string): Promise<string> {
  // Idempotent by title, same convention as every ad-platform tool here
  // (createOrReusePausedCampaign): a re-run of the same Task must not
  // litter the account with duplicate projects.
  const projects = await stitch.projects();
  const existing = projects.find((p) => (p.data as { title?: string } | undefined)?.title === title);
  if (existing) return existing.projectId;
  const created = await stitch.createProject(title);
  return created.projectId;
}

// generate_screen_from_text wants the design system's *resource name*
// ("assets/1234…"), not its bare id — confirmed against a real
// list_design_systems response. The SDK class exposes only assetId, so the
// resource name is read from `data` when present and reconstructed
// otherwise.
function designSystemResourceName(ds: { assetId: string; data: unknown }): string {
  const name = (ds.data as { name?: string } | undefined)?.name;
  return name ?? `assets/${ds.assetId}`;
}

async function ensureDesignSystem(projectId: string, brand: BrandInput | undefined): Promise<string | undefined> {
  const project = stitch.project(projectId);
  const displayName = "Agency standard";
  const existing = await project.listDesignSystems();
  const match = existing.find(
    (d) => (d.data as { designSystem?: { displayName?: string } } | undefined)?.designSystem?.displayName === displayName,
  );
  if (match) return designSystemResourceName(match);

  const created = await project.createDesignSystem({
    displayName,
    styleGuidelines: buildDesignMd(brand),
    theme: {
      designMd: buildDesignMd(brand),
      colorMode: brand?.colorMode ?? "LIGHT",
      ...(brand?.primaryColor ? { customColor: brand.primaryColor, overridePrimaryColor: brand.primaryColor } : {}),
      ...(brand?.headlineFont ? { headlineFont: brand.headlineFont as never } : {}),
      ...(brand?.bodyFont ? { bodyFont: brand.bodyFont as never } : {}),
    },
  });
  return designSystemResourceName(created);
}

export async function generateDesign(input: DesignBrief): Promise<DesignResult> {
  if (!process.env.STITCH_API_KEY) throw new Error("STITCH_API_KEY is not set");

  const projectId = await findOrCreateProject(input.projectTitle);
  const designSystem = await ensureDesignSystem(projectId, input.brand);

  const raw = (await Promise.race([
    stitch.callTool(GENERATE_TOOL, {
      projectId,
      prompt: input.brief,
      deviceType: input.deviceType ?? "DESKTOP",
      // Pro over Flash: this is a client-facing mockup, not a throwaway.
      modelId: "GEMINI_3_1_PRO",
      ...(designSystem ? { designSystem } : {}),
    }),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Stitch generation timed out")), GENERATION_TIMEOUT_MS),
    ),
  ])) as { outputComponents?: Array<{ design?: { screens?: Array<{ screenId?: string; id?: string }> } }> };

  const screenRef = (raw?.outputComponents ?? []).find((c) => c?.design?.screens != null)?.design?.screens?.[0];
  const screenId = screenRef?.screenId ?? screenRef?.id;
  if (!screenId) {
    throw new Error(`Stitch returned no screen for project "${projectId}"`);
  }

  const screen = await stitch.project(projectId).getScreen(screenId);
  const [html, screenshotUrl] = await Promise.all([screen.getHtml(), screen.getImage()]);

  return { screenshotUrl, html, projectId, screenId };
}
