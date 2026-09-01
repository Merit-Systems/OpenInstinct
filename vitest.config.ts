import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const sharedProjectConfig = {
  resolve: {
    alias: [
      {
        find: /^@\/(app|auth|components|hooks|lib|proxy|trpc)(\/.*)?$/,
        replacement: fileURLToPath(new URL("src/$1$2", import.meta.url)),
      },
      {
        find: "@",
        replacement: fileURLToPath(new URL(".", import.meta.url)),
      },
    ],
  },
  test: {
    setupFiles: ["./tests/setup-env.ts"],
    // PGlite-backed suites run ~3.5s alone and can exceed the 5s default
    // under the fully parallel run.
    testTimeout: 20_000,
  },
};
const defaultTestInclude = "**/*.{test,spec}.?(c|m)[jt]s?(x)";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      exclude: [
        "node_modules/**",
        ".next/**",
        "db/migrations/**",
        "tests/**",
        "**/*.config.*",
      ],
    },
    projects: [
      {
        ...sharedProjectConfig,
        test: {
          ...sharedProjectConfig.test,
          name: "unit",
          // Keep collecting new tests outside the tier directories.
          include: [defaultTestInclude],
          exclude: [
            "**/node_modules/**",
            "**/.next/**",
            "tests/integration/**",
            // Playwright owns the e2e tier; vitest must not collect its specs.
            "tests/e2e/**",
          ],
        },
      },
      {
        ...sharedProjectConfig,
        test: {
          ...sharedProjectConfig.test,
          name: "integration",
          include: ["tests/integration/**"],
        },
      },
    ],
  },
});
