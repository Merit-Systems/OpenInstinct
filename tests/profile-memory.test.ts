import type { MemoryScopeContext } from "eve/memory";
import { describe, expect, it } from "vitest";
import {
  resolveProfileMemoryBackend,
  resolveProfileMemoryScope,
} from "@/agent/lib/profile-memory";

describe("profile memory", () => {
  it("uses an explicit Blob backend only for token-backed production outside Vercel", () => {
    expect(
      resolveProfileMemoryBackend({
        BLOB_READ_WRITE_TOKEN: "blob-token",
        NODE_ENV: "production",
        VERCEL_ENV: undefined,
      })
    ).toEqual({ kind: "vercel-blob", token: "blob-token" });
    expect(
      resolveProfileMemoryBackend({
        BLOB_READ_WRITE_TOKEN: "blob-token",
        NODE_ENV: "production",
        VERCEL_ENV: "production",
      })
    ).toEqual({ kind: "automatic" });
    expect(
      resolveProfileMemoryBackend({
        BLOB_READ_WRITE_TOKEN: "blob-token",
        NODE_ENV: "development",
        VERCEL_ENV: undefined,
      })
    ).toEqual({ kind: "automatic" });
  });

  it("shares the canonical workspace across verified authenticators", () => {
    const workspaceId = "personal:workspace";
    expect(
      resolveProfileMemoryScope(
        memoryContext(userPrincipal("authjs", workspaceId))
      )
    ).toBe(workspaceId);
    expect(
      resolveProfileMemoryScope(
        memoryContext(userPrincipal("linq-message", workspaceId))
      )
    ).toBe(workspaceId);
  });

  it("disables memory without an authenticated workspace user", () => {
    expect(resolveProfileMemoryScope(memoryContext(null))).toBeNull();
    expect(
      resolveProfileMemoryScope(
        memoryContext({
          ...userPrincipal("runtime", "personal:workspace"),
          principalType: "runtime",
        })
      )
    ).toBeNull();
    expect(
      resolveProfileMemoryScope(memoryContext(userPrincipal("authjs")))
    ).toBeNull();
  });
});

function memoryContext(
  current: MemoryScopeContext["session"]["auth"]["current"]
): MemoryScopeContext {
  return {
    abortSignal: new AbortController().signal,
    channel: {},
    session: {
      auth: { current, initiator: null },
      id: "session",
    },
  };
}

function userPrincipal(
  authenticator: string,
  workspaceId?: string
): NonNullable<MemoryScopeContext["session"]["auth"]["current"]> {
  return {
    attributes: workspaceId === undefined ? {} : { workspaceId },
    authenticator,
    principalId: "better-auth:user",
    principalType: "user",
  };
}
