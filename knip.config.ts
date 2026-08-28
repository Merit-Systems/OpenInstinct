import type { KnipConfig } from "knip";

export default {
  entry: [
    "agent/channels/**/*.ts",
    "agent/extensions/**/*.ts",
    "agent/hooks/**/*.ts",
    "agent/tools/**/*.ts",
    "browser-extension/entrypoints/**/*.ts",
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
    // Loaded from generated configuration.
    "next-themes",
    "sonner",
    // Invoked as a CLI.
    "vercel",
  ],
  ignoreIssues: {
    // Eve AI Elements and shadcn registry primitives intentionally expose
    // a reusable component surface wider than this minimal chat consumes.
    "components/ai-elements/**/*.tsx": ["exports", "files", "types"],
    "components/ui/**/*.tsx": ["exports", "files", "types"],
    // Reserved for the vault-owned autofill provider implementation.
    "lib/payment-card.ts": ["exports"],
    "lib/server/secret-store.ts": ["exports"],
    "lib/server/vault-data.ts": ["exports"],
  },
  project: ["**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}"],
} satisfies KnipConfig;
