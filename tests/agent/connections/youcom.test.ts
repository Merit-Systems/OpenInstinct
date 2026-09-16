import type { McpClientConnectionDefinition } from "eve/connections";
import type { DynamicResolveContext } from "eve/tools";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requiredEnvironment = {
  BETTER_AUTH_SECRET: "test-auth-secret-0123456789abcdefghijklmnop",
  BETTER_AUTH_URL: "https://example.com",
  BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_test",
  DATABASE_URL: "postgresql://user:***@example.com/database",
  KERNEL_API_KEY: "test-kernel-key",
  SECRET_ENCRYPTION_KEY: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=",
};

const resolveContext = {
  model: null,
  channel: { kind: "channel:linq", metadata: {} },
  messages: [],
  session: {
    auth: {
      current: {
        attributes: { workspaceId: "personal:workspace" },
        authenticator: "linq-message",
        principalId: "user-1",
        principalType: "user",
      },
      initiator: null,
    },
    id: "session-1",
  },
} satisfies DynamicResolveContext;

describe("youcom connection", () => {
  beforeEach(() => {
    vi.resetModules();
    for (const [name, value] of Object.entries(requiredEnvironment)) {
      vi.stubEnv(name, value);
    }
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is omitted without a You.com API key", async () => {
    vi.stubEnv("YOU_API_KEY", "");

    const { default: youcom } = await import("@agent/connections/youcom");
    const resolve = youcom.events["session.started"];
    expect(resolve).toBeDefined();
    if (!resolve) return;

    expect(await resolve({}, resolveContext)).toBeNull();
  });

  it("exposes the You.com MCP search connection with an API key", async () => {
    vi.stubEnv("YOU_API_KEY", "test-youcom-key");

    const { default: youcom } = await import("@agent/connections/youcom");
    const resolve = youcom.events["session.started"];
    expect(resolve).toBeDefined();
    if (!resolve) return;

    const resolved = await resolve({}, resolveContext);
    // SAFETY: The resolver returns a single connection definition, so the
    // dynamic result is the MCP connection definition this module builds.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- This test asserts the exact connection definition the youcom resolver builds.
    const connection = resolved as McpClientConnectionDefinition;
    expect(connection).toMatchObject({
      instanceKey: "youcom",
      url: "https://api.you.com/mcp",
    });
    expect(connection.description).toContain("You.com web search");
  });

  it("sends the configured API key as the bearer token", async () => {
    vi.stubEnv("YOU_API_KEY", "test-youcom-key");

    const { default: youcom } = await import("@agent/connections/youcom");
    const resolve = youcom.events["session.started"];
    expect(resolve).toBeDefined();
    if (!resolve) return;

    const resolved = await resolve({}, resolveContext);
    // SAFETY: The resolver returns a single connection definition, so the
    // dynamic result is the MCP connection definition this module builds.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- This test asserts the exact connection definition the youcom resolver builds.
    const connection = resolved as McpClientConnectionDefinition;
    const auth = connection.auth;
    expect(auth).toBeDefined();
    if (!auth || !("getToken" in auth)) return;

    await expect(
      auth.getToken({
        connection: { url: "https://api.you.com/mcp" },
        principal: { type: "app" },
      })
    ).resolves.toEqual({ token: "test-youcom-key" });
  });
});
