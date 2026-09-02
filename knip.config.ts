import type { KnipConfig } from "knip";

export default {
  entry: [
    "agent/channels/**/*.ts",
    "agent/hooks/**/*.ts",
    "agent/instructions/**/*.ts",
    "agent/memory/**/*.ts",
    "agent/subagents/**/*.ts",
    "agent/schedules/**/*.ts",
    "agent/tools/**/*.ts",
    "db/drizzle.config.ts",
    // Drizzle consumes every table and relation exported by this schema barrel.
    "db/schema/index.ts",
    "evals/**/*.eval.ts",
    "evals/evals.config.ts",
    "taze.config.ts",
  ],
  ignoreDependencies: [
    // Type owners referenced by the Eve declaration patch, which Knip does not parse.
    "@linqapp/chat-sdk-adapter",
    "chat",
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
    // Eve AI Elements and shadcn registry primitives intentionally expose
    // a reusable component surface wider than this minimal chat consumes.
    "src/components/ai-elements/**/*.tsx": ["exports", "files", "types"],
    "src/components/ui/**/*.tsx": ["exports", "files", "types"],
  },
  project: ["**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}"],
} satisfies KnipConfig;
