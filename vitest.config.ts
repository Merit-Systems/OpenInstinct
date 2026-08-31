import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@\/(app|auth|components|hooks|lib|trpc)(\/.*)?$/,
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
  },
});
