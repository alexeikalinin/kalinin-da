import { createClient } from "v0-sdk";

// Tool Integration §1 — UI Designer Agent's "design-tool", second
// implementation. The first (stitch-design.ts, kept in the codebase but not
// wired) turned out not to work: stitch.googleapis.com rejects API keys
// outright ("Expected OAuth2 access token... that asserts a principal") —
// a known, unresolved issue in the SDK itself (google-labs-code/stitch-sdk
// #366), confirmed live against a real STITCH_API_KEY on 2026-08-26. A
// Google forum rep separately stated Stitch generation "is not possible to
// automate via a REST API at this time." v0 Platform API needs only a plain
// bearer key (V0_API_KEY) — no OAuth, no GCP project, no service account —
// and is Vercel's own product, which this agency already runs on.
const GENERATION_TIMEOUT_MS = 300_000;

export function isV0Configured(): boolean {
  return Boolean(process.env.V0_API_KEY);
}

export interface DesignBrief {
  // What to design, in prose — the whole input to this tool. Composed by
  // the caller from the task description, UX's plan, and client facts (see
  // @ama/agent-ui-designer's dispatch.ts composeDesignBrief).
  readonly brief: string;
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
  readonly screenshotUrl?: string;
  readonly demoUrl?: string;
  // v0 always returns a full Next.js project (page.tsx + layout.tsx +
  // globals.css + package.json), not standalone HTML — real bug found
  // 2026-09-03 deploying a self-promo landing page: an earlier version of
  // this field was named `html` and held only page.tsx's raw JSX/TSX
  // source, which deployment-tool then wrote out as a literal index.html
  // file. Vercel tried to serve that TSX source as a static page and the
  // deployment failed outright. `files` carries every file v0 returned so
  // deployment-tool (vercel-deploy.ts) can deploy the whole project and
  // build it with the Next.js framework instead.
  readonly files: Record<string, string>;
  readonly chatId: string;
}

// The craft floor, same content as the Stitch tool's design-md — kept in
// one place conceptually (Domain KB candidate per backlog #26, not
// duplicated logic to maintain). Passed as v0's `system` prompt, since v0
// has no separate design-system object the way Stitch does — the standard
// has to travel inside the instruction itself.
function buildSystemPrompt(brand: BrandInput | undefined): string {
  return [
    "Ты дизайнер уровня топовой студии. Строгие правила качества, не нарушай их:",
    "",
    "Типографика: чёткая типографическая шкала без произвольных размеров; не больше двух гарнитур (одна для заголовков, одна для текста); заголовки — со сжатым межбуквенным интервалом и балансом переносов; тело текста — не шире ~65 символов в строке.",
    "Цвет: один акцент, используется скупо, только для самого важного действия на экране; нейтральные цвета — с лёгким сдвигом в оттенок акцента, никогда плоский средний серый.",
    "Композиция: реальная визуальная иерархия — один явный фокус на экране, остальное подчинено; группировка через близость, а не через рамки; много воздуха вместо плотной упаковки.",
    "Категорически избегай: центрирования всего подряд, секций одинакового веса, скруглённых карточек с акцентной полоской сбоку, декоративных градиентов и теней вместо иерархии, placeholder/lorem-текста — пиши реальный текст по теме брифа.",
    brand?.styleNotes ? `\nБренд-заметки: ${brand.styleNotes}` : "",
    brand?.primaryColor ? `Акцентный цвет: ${brand.primaryColor}.` : "",
    brand?.colorMode ? `Цветовой режим: ${brand.colorMode === "DARK" ? "тёмный" : "светлый"}.` : "",
    brand?.headlineFont ? `Гарнитура заголовков: ${brand.headlineFont}.` : "",
    brand?.bodyFont ? `Гарнитура текста: ${brand.bodyFont}.` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function generateDesign(input: DesignBrief): Promise<DesignResult> {
  if (!process.env.V0_API_KEY) throw new Error("V0_API_KEY is not set");
  const v0 = createClient({ apiKey: process.env.V0_API_KEY });

  const result = (await Promise.race([
    v0.chats.create({
      message: input.brief,
      system: buildSystemPrompt(input.brand),
      chatPrivacy: "private",
      responseMode: "sync",
      modelConfiguration: { modelId: "v0-max" },
    }),
    new Promise((_, reject) => setTimeout(() => reject(new Error("v0 generation timed out")), GENERATION_TIMEOUT_MS)),
  ])) as {
    id: string;
    latestVersion?: {
      demoUrl?: string;
      screenshotUrl?: string;
      files: Array<{ name: string; content: string }>;
    };
  };

  const files = result.latestVersion?.files ?? [];
  if (files.length === 0) {
    throw new Error(`v0 returned no files for chat "${result.id}"`);
  }

  const fileMap = Object.fromEntries(files.map((f) => [f.name, f.content]));

  return {
    screenshotUrl: result.latestVersion?.screenshotUrl,
    demoUrl: result.latestVersion?.demoUrl,
    files: withBoilerplate(fileMap),
    chatId: result.id,
  };
}

// v0's chat API only returns the files the AI actually wrote for this chat
// (page.tsx/layout.tsx/globals.css/package.json) — not the fixed boilerplate
// every v0 Next.js + Tailwind v4 project also needs. Missing this silently:
// without postcss.config.mjs specifically, Next never runs the Tailwind
// PostCSS plugin, so the page builds and deploys with NO build error but
// renders completely unstyled (found 2026-09-03 deploying the self-promo
// landing page — the shipped CSS had only @font-face rules, zero utility
// classes). Only fills in files the response didn't already provide, so a
// future v0 API version that does include them isn't overridden.
function withBoilerplate(files: Record<string, string>): Record<string, string> {
  const withDefaults = { ...files };
  if (!withDefaults["postcss.config.mjs"]) {
    withDefaults["postcss.config.mjs"] = `const config = {\n  plugins: {\n    "@tailwindcss/postcss": {},\n  },\n};\n\nexport default config;\n`;
  }
  if (!withDefaults["next.config.mjs"]) {
    withDefaults["next.config.mjs"] = `/** @type {import('next').NextConfig} */\nconst nextConfig = {};\n\nexport default nextConfig;\n`;
  }
  if (!withDefaults["tsconfig.json"]) {
    withDefaults["tsconfig.json"] = JSON.stringify(
      {
        compilerOptions: {
          target: "ES2017",
          lib: ["dom", "dom.iterable", "esnext"],
          allowJs: true,
          skipLibCheck: true,
          strict: true,
          noEmit: true,
          esModuleInterop: true,
          module: "esnext",
          moduleResolution: "bundler",
          resolveJsonModule: true,
          isolatedModules: true,
          jsx: "preserve",
          incremental: true,
          plugins: [{ name: "next" }],
          paths: { "@/*": ["./*"] },
        },
        include: ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
        exclude: ["node_modules"],
      },
      null,
      2,
    );
  }
  return withDefaults;
}
