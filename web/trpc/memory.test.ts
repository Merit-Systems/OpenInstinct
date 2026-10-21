import type { knowledgeMemoryModeForWorkspace } from "@shared/memory/config";
import type {
  listMemoryBindings,
  readMemoryBinding,
} from "@db/services/memory/scope";
import type {
  editMemoryRecord,
  exportMemoryRecords,
  findMemoryRecords,
  forgetMemoryRecord,
  memoryRecordHistory,
  readMemoryRecord,
} from "@db/services/memory/records";
import type { readMemoryHealth } from "@db/services/memory/health";
import type { readMemoryModelUsage } from "@db/services/memory/usage";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryRouter } from "./memory";

const mocks = vi.hoisted(() => ({
  mode: vi.fn<typeof knowledgeMemoryModeForWorkspace>(),
  health: vi.fn<typeof readMemoryHealth>(),
  usage: vi.fn<typeof readMemoryModelUsage>(),
  bindings: {
    listMemoryBindings: vi.fn<typeof listMemoryBindings>(),
    readMemoryBinding: vi.fn<typeof readMemoryBinding>(),
  },
  records: {
    editMemoryRecord: vi.fn<typeof editMemoryRecord>(),
    exportMemoryRecords: vi.fn<typeof exportMemoryRecords>(),
    findMemoryRecords: vi.fn<typeof findMemoryRecords>(),
    forgetMemoryRecord: vi.fn<typeof forgetMemoryRecord>(),
    memoryRecordHistory: vi.fn<typeof memoryRecordHistory>(),
    readMemoryRecord: vi.fn<typeof readMemoryRecord>(),
  },
}));
vi.mock("@shared/memory/config", () => ({
  knowledgeMemoryModeForWorkspace: mocks.mode,
}));
vi.mock("@db/services/memory/scope", () => mocks.bindings);
vi.mock("@db/services/memory/records", () => mocks.records);
vi.mock("@db/services/memory/health", () => ({
  readMemoryHealth: mocks.health,
}));
vi.mock("@db/services/memory/usage", () => ({
  readMemoryModelUsage: mocks.usage,
}));

const scope = { userId: "owner", workspaceId: "workspace" };
const caller = () =>
  memoryRouter.createCaller({ origin: "https://example.com", scope });
const record = {
  sessionId: "owned-chat",
  id: "record-1",
  expectedRevision: 0,
  kind: "preference" as const,
  title: "Dining",
  body: "I prefer vegetarian food.",
  aliases: ["food"],
  operationId: "81e908d6-8d06-46f6-a23e-85675daa9515",
};

describe("memory router scope and controls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mode.mockReturnValue("enabled");
    mocks.bindings.readMemoryBinding.mockResolvedValue({
      scopeKey: "trusted-eve-scope",
      sessionId: "owned-chat",
      namespace: "private-namespace",
      workspaceId: scope.workspaceId,
      userId: scope.userId,
      cursor: 0,
      captureAfter: new Date("2026-10-21T12:00:00Z"),
      captureDisabled: false,
      updatedAt: new Date("2026-10-21T12:00:00Z"),
    });
    mocks.bindings.listMemoryBindings.mockResolvedValue([
      {
        sessionId: "owned-chat",
        namespace: "private-namespace",
        workspaceId: scope.workspaceId,
        userId: scope.userId,
        cursor: 0,
        captureAfter: new Date("2026-10-21T12:00:00Z"),
        captureDisabled: false,
        scopeKey: "trusted-eve-scope",
        updatedAt: new Date("2026-10-21T12:00:00Z"),
      },
    ]);
  });

  it("hides all memory endpoints when the workspace is disabled", async () => {
    mocks.mode.mockReturnValue("off");
    await expect(caller().bindings()).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(caller().save(record)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      caller().status({ sessionId: record.sessionId })
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(mocks.bindings.listMemoryBindings).not.toHaveBeenCalled();
    expect(mocks.records.editMemoryRecord).not.toHaveBeenCalled();
    expect(mocks.health).not.toHaveBeenCalled();
    expect(mocks.usage).not.toHaveBeenCalled();
  });

  it("returns only owned chat references to the browser", async () => {
    await expect(caller().bindings()).resolves.toEqual([
      { sessionId: "owned-chat", updatedAt: "2026-10-21T12:00:00.000Z" },
    ]);
    expect(mocks.bindings.listMemoryBindings).toHaveBeenCalledWith(scope);
  });

  it("resolves every list scope from the authenticated owned session", async () => {
    await caller().list({ sessionId: "owned-chat", query: "food" });
    expect(mocks.bindings.readMemoryBinding).toHaveBeenCalledWith(
      scope,
      "owned-chat"
    );
    expect(mocks.records.findMemoryRecords).toHaveBeenCalledWith(
      scope,
      "trusted-eve-scope",
      { query: "food", offset: 0, includeHistorical: false }
    );
  });

  it("rejects a session without an owned binding", async () => {
    mocks.bindings.readMemoryBinding.mockResolvedValue(null);
    await expect(
      caller().read({ sessionId: "another-users-chat", id: "record-1" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      caller().status({ sessionId: "another-users-chat" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mocks.records.readMemoryRecord).not.toHaveBeenCalled();
    expect(mocks.health).not.toHaveBeenCalled();
    expect(mocks.usage).not.toHaveBeenCalled();
  });

  it("scopes operational counts to the owned binding and usage to its workspace", async () => {
    await caller().status({ sessionId: record.sessionId });
    const untrusted = { sessionId: record.sessionId, workspaceId: "other" };
    await expect(caller().status(untrusted)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(mocks.health).toHaveBeenCalledExactlyOnceWith(
      scope,
      "trusted-eve-scope"
    );
    expect(mocks.usage).toHaveBeenCalledExactlyOnceWith(scope);
  });

  it("rejects client supplied scope and owner fields", async () => {
    const untrusted = { ...record, scopeKey: "attacker", workspaceId: "other" };
    await expect(caller().save(untrusted)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(mocks.records.editMemoryRecord).not.toHaveBeenCalled();
  });

  it("saves an explicit edit using the trusted scope and client retry identifier", async () => {
    await caller().save(record);
    const { sessionId: _sessionId, operationId, ...input } = record;
    expect(mocks.records.editMemoryRecord).toHaveBeenCalledWith(
      scope,
      "trusted-eve-scope",
      input,
      operationId
    );
  });

  it("requires the expected revision to forget a record", async () => {
    await caller().forget({
      sessionId: record.sessionId,
      id: record.id,
      expectedRevision: 4,
      operationId: record.operationId,
    });
    expect(mocks.records.forgetMemoryRecord).toHaveBeenCalledWith(
      scope,
      "trusted-eve-scope",
      { id: record.id, expectedRevision: 4 },
      record.operationId
    );
  });

  it("scopes history and export identically to reads", async () => {
    await caller().history({ sessionId: record.sessionId, id: record.id });
    await caller().export({ sessionId: record.sessionId });
    expect(mocks.records.memoryRecordHistory).toHaveBeenCalledWith(
      scope,
      "trusted-eve-scope",
      record.id
    );
    expect(mocks.records.exportMemoryRecords).toHaveBeenCalledWith(
      scope,
      "trusted-eve-scope"
    );
  });

  it("allows inspection in shadow mode", async () => {
    mocks.mode.mockReturnValue("shadow");
    await caller().list({ sessionId: record.sessionId });
    expect(mocks.records.findMemoryRecords).toHaveBeenCalledOnce();
  });
});
