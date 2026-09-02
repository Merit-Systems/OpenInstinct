import type { MemoryScopeContext, MemoryToolsContext } from "eve/memory";
import { describe, expect, it } from "vitest";
import personalInfoMemory from "@/agent/memory/personal_info";
import {
  resolveProfileMemoryBackend,
  resolveProfileMemoryScope,
} from "@/agent/lib/profile-memory";

describe("profile memory", () => {
  it("uses an explicit Blob backend for an attached store in production", () => {
    expect(
      resolveProfileMemoryBackend({
        BLOB_READ_WRITE_TOKEN: undefined,
        BLOB_STORE_ID: "store-id",
        NODE_ENV: "production",
        VERCEL_ENV: "production",
      })
    ).toEqual({
      kind: "vercel-blob",
      options: { storeId: "store-id" },
    });
    expect(
      resolveProfileMemoryBackend({
        BLOB_READ_WRITE_TOKEN: "blob-token",
        BLOB_STORE_ID: undefined,
        NODE_ENV: "production",
        VERCEL_ENV: undefined,
      })
    ).toEqual({
      kind: "vercel-blob",
      options: { token: "blob-token" },
    });
    expect(
      resolveProfileMemoryBackend({
        BLOB_READ_WRITE_TOKEN: "blob-token",
        BLOB_STORE_ID: undefined,
        NODE_ENV: "production",
        VERCEL_ENV: "production",
      })
    ).toEqual({ kind: "automatic" });
    expect(
      resolveProfileMemoryBackend({
        BLOB_READ_WRITE_TOKEN: "blob-token",
        BLOB_STORE_ID: "store-id",
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

  it("shares personal information with a worker acting for the user", () => {
    expect(
      personalInfoMemory.scope(
        memoryContext(
          {
            attributes: {},
            authenticator: "runtime",
            principalId: "worker",
            principalType: "runtime",
          },
          userPrincipal("authjs", "personal:workspace")
        )
      )
    ).toBe("personal:workspace");
  });

  it("omits user memory from scheduled reporting turns", () => {
    const context = memoryContext(
      userPrincipal("scheduled-result", "personal:workspace")
    );

    expect(resolveProfileMemoryScope(context)).toBeNull();
    expect(personalInfoMemory.scope(context)).toBeNull();
  });

  it("offers profile updates only during interactive turns", async () => {
    const interactiveTools = await personalInfoMemory.provider.tools(
      memoryToolsContext(userPrincipal("authjs", "personal:workspace"))
    );
    expect(Object.keys(interactiveTools ?? {})).toEqual(["update"]);

    const scheduledTools = await personalInfoMemory.provider.tools(
      memoryToolsContext(
        userPrincipal("scheduled-worker", "personal:workspace")
      )
    );
    expect(scheduledTools).toBeNull();
  });
});

function memoryToolsContext(
  current: MemoryToolsContext["session"]["auth"]["current"],
  initiator: MemoryToolsContext["session"]["auth"]["initiator"] = null
): MemoryToolsContext {
  return {
    channel: {},
    memory: {
      scope: {
        key: "personal-info-key",
        namespace: "openinstinct-personal-info-v1",
        value: "personal:workspace",
      },
      slot: "personal_info",
    },
    messages: [],
    session: {
      auth: { current, initiator },
      id: "session",
    },
    turn: { id: "turn", input: [], sequence: 1 },
  };
}

function memoryContext(
  current: MemoryScopeContext["session"]["auth"]["current"],
  initiator: MemoryScopeContext["session"]["auth"]["initiator"] = null
): MemoryScopeContext {
  return {
    abortSignal: new AbortController().signal,
    channel: {},
    session: {
      auth: { current, initiator },
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
