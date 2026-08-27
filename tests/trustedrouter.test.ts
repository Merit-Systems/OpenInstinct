import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requiredEnvironment = {
  BETTER_AUTH_SECRET: "test-auth-secret",
  BETTER_AUTH_URL: "https://example.com",
  DATABASE_URL: "postgresql://user:password@example.com/database",
  KERNEL_API_KEY: "test-kernel-key",
  SECRET_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
};

const catalogPayload = {
  data: [
    {
      context_length: 200_000,
      id: "trustedrouter/auto",
      name: "TrustedRouter Auto",
      pricing: { completion: "0.0000001899", prompt: "0.0000000844" },
      trustedrouter: { provider: "trustedrouter", supports_chat: true },
    },
    {
      context_length: 4096,
      id: "openai/text-embedding-3-small",
      name: "OpenAI: Embedding 3 Small",
      trustedrouter: { provider: "openai", supports_chat: false },
    },
    {
      // The live catalog reports an unknown context window as 0; dropping the
      // entry has to beat rejecting the whole response.
      context_length: 0,
      id: "example/unknown-context",
      name: "Example: Unknown Context",
      trustedrouter: { provider: "example", supports_chat: true },
    },
  ],
};

function stubCatalogFetch(payload: unknown = catalogPayload) {
  return vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(Response.json(payload));
}

describe("TrustedRouter provider", () => {
  beforeEach(() => {
    vi.resetModules();
    for (const [name, value] of Object.entries(requiredEnvironment)) {
      vi.stubEnv(name, value);
    }
    vi.stubEnv("HOSTED_SECRET_ENCRYPTION_KEY", "");
    vi.stubEnv("TRUSTEDROUTER_BASE_URL", "");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("stays on the AI Gateway until a key is configured", async () => {
    vi.stubEnv("TRUSTEDROUTER_API_KEY", "");

    const { getTrustedRouterConfig } = await import("../lib/trustedrouter");
    expect(getTrustedRouterConfig()).toBeUndefined();
  });

  it("defaults to the public endpoint and accepts an override", async () => {
    vi.stubEnv("TRUSTEDROUTER_API_KEY", "sk-tr-test");

    const first = await import("../lib/trustedrouter");
    expect(first.getTrustedRouterConfig()).toEqual({
      apiKey: "sk-tr-test",
      baseUrl: "https://api.trustedrouter.com/v1",
    });

    vi.resetModules();
    vi.stubEnv("TRUSTEDROUTER_BASE_URL", "https://gateway.example.com/v1");

    const second = await import("../lib/trustedrouter");
    expect(second.getTrustedRouterConfig()?.baseUrl).toBe(
      "https://gateway.example.com/v1"
    );
  });

  it("keeps only chat models and converts pricing to dollars per million", async () => {
    vi.stubEnv("TRUSTEDROUTER_API_KEY", "sk-tr-test");
    const fetchSpy = stubCatalogFetch();

    const { fetchTrustedRouterCatalog, getTrustedRouterConfig } =
      await import("../lib/trustedrouter");
    const config = getTrustedRouterConfig();
    if (!config) throw new Error("Expected a TrustedRouter configuration.");

    expect(await fetchTrustedRouterCatalog(config)).toEqual([
      {
        contextWindow: 200_000,
        id: "trustedrouter/auto",
        name: "TrustedRouter Auto",
        ownedBy: "trustedrouter",
        pricing: { input: 0.0844, output: 0.1899 },
      },
    ]);

    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url instanceof URL && url.href).toBe(
      "https://api.trustedrouter.com/v1/models"
    );
    expect(new Headers(init?.headers).get("authorization")).toBe(
      "Bearer sk-tr-test"
    );
  });

  it("carries the context window eve cannot read from the AI Gateway", async () => {
    vi.stubEnv("TRUSTEDROUTER_API_KEY", "sk-tr-test");
    stubCatalogFetch();

    const { getTrustedRouterConfig, selectTrustedRouterModel } =
      await import("../lib/trustedrouter");
    const config = getTrustedRouterConfig();
    if (!config) throw new Error("Expected a TrustedRouter configuration.");

    const selection = await selectTrustedRouterModel(config, undefined);

    expect(selection.modelId).toBe("trustedrouter/auto");
    expect(selection.modelContextWindowTokens).toBe(200_000);
    expect(selection.model).toMatchObject({
      modelId: "trustedrouter/auto",
      provider: "trustedrouter.chat",
    });
    await expect(
      selectTrustedRouterModel(config, "openai/text-embedding-3-small")
    ).rejects.toThrow("does not offer a chat model");
  });

  it("serves a stale catalog rather than failing the request", async () => {
    vi.stubEnv("TRUSTEDROUTER_API_KEY", "sk-tr-test");
    const fetchSpy = stubCatalogFetch();

    const { fetchTrustedRouterCatalog, getTrustedRouterConfig } =
      await import("../lib/trustedrouter");
    const config = getTrustedRouterConfig();
    if (!config) throw new Error("Expected a TrustedRouter configuration.");

    const fresh = await fetchTrustedRouterCatalog(config);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Expire the cache so the stale entry is only reachable through the
    // failure path, then take the catalog endpoint down.
    const expired = Date.now() + 10 * 60 * 1000;
    vi.spyOn(Date, "now").mockReturnValue(expired);
    fetchSpy.mockRejectedValue(new Error("network down"));

    expect(await fetchTrustedRouterCatalog(config)).toEqual(fresh);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
