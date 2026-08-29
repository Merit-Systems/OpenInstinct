import type { KnipConfig } from "knip";

export default {
  entry: [
    "agent/channels/**/*.ts",
    "agent/hooks/**/*.ts",
    "agent/instructions/**/*.ts",
    "agent/memory/**/*.ts",
    "agent/subagents/**/*.ts",
    "agent/tools/**/*.ts",
    "db/drizzle.config.ts",
    "evals/**/*.eval.ts",
    "evals/evals.config.ts",
    "taze.config.ts",
  ],
  ignoreDependencies: [
    // Imported through the owning Tailwind stylesheet rather than TypeScript.
    "shadcn",
    "tailwindcss",
    // Loaded as jsPlugins from .oxlintrc.jsonc rather than TypeScript.
    "eslint-plugin-react-hooks",
    "eslint-plugin-turbo",
    "oxlint-tailwindcss",
    // Invoked as a CLI.
    "vercel",
  ],
  ignoreIssues: {
    // The workspace agent service is consumed dynamically in its PGlite
    // integration test until the control-plane API is introduced.
    "db/services/agents.ts": ["exports"],
    // Phone identity lookups and revocation are consumed by the incoming Linq
    // identity flow; the verification write is wired into Better Auth today.
    "db/services/phone-identities.ts": ["exports"],
    // Usage aggregation is a deliberate service API for future workspace
    // reporting; budget enforcement consumes it internally today.
    "db/services/usage.ts": ["exports"],
    // The operability error is a public typed denial for callers of the
    // shared guard, which is loaded by the budget service at runtime.
    "db/services/scope.ts": ["exports"],
    // Lifecycle control-plane actions are covered by PGlite integration tests
    // until the workspace management API is introduced.
    "db/services/workspace-lifecycle.ts": ["exports"],
    // Eve AI Elements and shadcn registry primitives intentionally expose
    // a reusable component surface wider than this minimal chat consumes.
    "components/ai-elements/**/*.tsx": ["exports", "files", "types"],
    "components/ui/**/*.tsx": ["exports", "files", "types"],
  },
  project: ["**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}"],
} satisfies KnipConfig;
