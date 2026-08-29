/* oxlint-disable typescript/no-unsafe-assignment, typescript/no-unsafe-type-assertion, typescript/no-unnecessary-type-assertion -- Eve's Linq adapter exposes the inbound handler through transitive any types; this fixture supplies only the fields it exercises. */
import type * as EnvModule from "@/lib/env";
import type * as LinqModule from "eve/channels/linq";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  config: undefined as unknown,
  findOne: vi.fn<() => Promise<unknown>>(),
  scopeEnforcementEnabled: vi.fn<() => boolean>(),
  verifyScopeAccess: vi.fn<(_scope: unknown) => Promise<unknown>>(),
}));

vi.mock("@/auth", () => ({
  auth: {
    $context: Promise.resolve({ adapter: { findOne: mocks.findOne } }),
  },
}));
vi.mock("@/db/services/scope", () => ({
  verifyScopeAccess: mocks.verifyScopeAccess,
}));
vi.mock("@/lib/env", async (importOriginal) => ({
  ...(await importOriginal<typeof EnvModule>()),
  isWorkspaceScopeEnforcementEnabled: mocks.scopeEnforcementEnabled,
}));
vi.mock("eve/channels/linq", async (importOriginal) => {
  const original = await importOriginal<typeof LinqModule>();
  return {
    ...original,
    linqChannel(config: unknown) {
      mocks.config = config;
      return config;
    },
  };
});

await import("../agent/channels/linq");

const onMessage = (mocks.config as LinqModule.LinqChannelConfig).onMessage;
if (!onMessage) throw new Error("Linq onMessage is not configured.");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.scopeEnforcementEnabled.mockReturnValue(false);
  mocks.findOne.mockResolvedValue(null);
});

describe("Linq channel scope", () => {
  it("does not verify membership while enforcement is off", async () => {
    const result = await onMessage(
      {} as never,
      { author: { isBot: false, userName: "+12025550123" } } as never
    );

    expect(result).toMatchObject({
      auth: { attributes: { workspaceId: expect.any(String) } },
    });
    expect(mocks.verifyScopeAccess).not.toHaveBeenCalled();
  });

  it("drops a denied scope while enforcement is on", async () => {
    mocks.scopeEnforcementEnabled.mockReturnValue(true);
    mocks.verifyScopeAccess.mockResolvedValue(undefined);

    await expect(
      onMessage(
        {} as never,
        { author: { isBot: false, userName: "+12025550123" } } as never
      )
    ).resolves.toBeNull();
  });
});
