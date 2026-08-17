import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {};

// If middleware.ts is ever added to this app, exclude the compiler-generated
// `.well-known/workflow` path from its matcher — Workflow DevKit's internal
// routes must not be intercepted.
export default withWorkflow(nextConfig);
