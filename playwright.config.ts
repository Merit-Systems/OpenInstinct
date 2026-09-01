import { randomBytes } from "node:crypto";
import { defineConfig } from "@playwright/test";

const baseURL = "http://localhost:3000";
const storageState = "playwright/.auth/user.json";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 90_000,
  expect: {
    timeout: 15_000,
  },
  // oxlint-disable-next-line eslint/no-restricted-properties, turbo/no-undeclared-env-vars -- Playwright owns this CI-only runner setting outside the application runtime.
  retries: process.env.CI ? 1 : 0,
  reporter: "html",
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "setup",
      testMatch: /.*\.setup\.ts/,
    },
    {
      name: "chromium",
      dependencies: ["setup"],
      testIgnore: /.*\.setup\.ts/,
      use: {
        browserName: "chromium",
        storageState,
      },
    },
  ],
  webServer: {
    command: "node scripts/dev.ts",
    env: {
      BETTER_AUTH_SECRET: "e2e-better-auth-secret-for-playwright-tests",
      BETTER_AUTH_URL: baseURL,
      KERNEL_API_KEY: "e2e-kernel-key",
      ADMIN_PHONE_NUMBERS: "+12025550123",
      SECRET_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
      WORKSPACE_SCOPE_ENFORCEMENT: "enforce",
    },
    gracefulShutdown: {
      signal: "SIGTERM",
      timeout: 30_000,
    },
    // oxlint-disable-next-line eslint/no-restricted-properties, turbo/no-undeclared-env-vars -- Playwright's documented local-server reuse switch is CI-specific.
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    url: baseURL,
  },
});
