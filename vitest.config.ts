import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: "server-only",
        replacement: fileURLToPath(
          new URL("tests/helpers/server-only.ts", import.meta.url)
        ),
      },
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
