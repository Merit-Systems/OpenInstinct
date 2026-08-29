import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    setupFiles: ["./tests/setup-env.ts"],
    // PGlite-backed suites run ~3.5s alone and can exceed the 5s default
    // under the fully parallel run.
    testTimeout: 20_000,
  },
});
