import type { KnipConfig } from "knip";

export default {
  entry: [
    "agent/channels/**/*.ts",
    "agent/extensions/**/*.ts",
    "agent/tools/**/*.ts",
    "evals/**/*.eval.ts",
    "evals/evals.config.ts",
    "foundation.config.ts",
    "taze.config.ts",
  ],
  ignoreDependencies: [
    // Imported through the owning Tailwind stylesheet rather than TypeScript.
    "@merit-systems/brand",
    "shadcn",
    "tailwindcss",
    // Loaded from generated configuration and the Foundation Base UI baseline.
    "@merit-systems/oxlint-config",
    "next-themes",
    "sonner",
    // Executed by the local shell launcher rather than imported by TypeScript.
    "portless",
  ],
  ignoreIssues: {
    // Eve AI Elements and Foundation registry primitives intentionally expose
    // a reusable component surface wider than this minimal chat consumes.
    "components/ai-elements/**/*.tsx": ["exports", "files", "types"],
    "components/ui/**/*.tsx": ["exports", "files", "types"],
  },
  project: ["**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}"],
} satisfies KnipConfig;
