import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requiredEnvironment = {
  BETTER_AUTH_SECRET: "test-auth-secret",
  BETTER_AUTH_URL: "https://example.com",
  DATABASE_URL: "postgresql://user:password@example.com/database",
  KERNEL_API_KEY: "test-kernel-key",
  SECRET_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
};

describe("environment", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    for (const [name, value] of Object.entries(requiredEnvironment)) {
      vi.stubEnv(name, value);
    }
    vi.stubEnv("HOSTED_SECRET_ENCRYPTION_KEY", "");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("exports the validated environment", async () => {
    const { env } = await import("../lib/env");

    expect(env).toMatchObject(requiredEnvironment);
  });

  it.each([
    requiredEnvironment.SECRET_ENCRYPTION_KEY.slice(0, -1),
    Buffer.alloc(32, 255).toString("base64url"),
  ])("accepts a Node-compatible 32-byte encryption key", async (key) => {
    vi.stubEnv("SECRET_ENCRYPTION_KEY", key);

    const { env } = await import("../lib/env");
    expect(env.SECRET_ENCRYPTION_KEY).toBe(key);
  });

  it.each([
    ["BETTER_AUTH_SECRET", "Invalid environment variables"],
    ["BETTER_AUTH_URL", "Invalid environment variables"],
    ["DATABASE_URL", "Invalid environment variables"],
    ["KERNEL_API_KEY", "Invalid environment variables"],
    ["SECRET_ENCRYPTION_KEY", "SECRET_ENCRYPTION_KEY is required"],
  ])(
    "rejects a missing required %s value during import",
    async (name, errorMessage) => {
      vi.stubEnv(name, "");

      await expect(import("../lib/env")).rejects.toThrow(errorMessage);
    }
  );

  it("rejects a non-Postgres database URL", async () => {
    vi.stubEnv("DATABASE_URL", "https://example.com/database");

    await expect(import("../lib/env")).rejects.toThrow(
      "Invalid environment variables"
    );
  });
});
