import { z } from "zod";
import type * as Blob from "@vercel/blob";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MemoryBudgetExceededError,
  MemoryRequestTooLargeError,
} from "@db/services/memory/usage";
import type * as Jobs from "@db/services/memory/jobs";
import type { followMemoryLinks } from "@db/services/memory/records";
import type { readMemoryState } from "@db/services/memory/scope";
import type * as Artifacts from "@db/services/memory/artifacts";
import type { reconcileKnowledge } from "./reconcile";

const mocks = vi.hoisted(() => ({
  mode: "enabled",
  links: vi.fn<typeof followMemoryLinks>(),
  state: vi.fn<typeof readMemoryState>(),
  ready: vi.fn<typeof Jobs.listReadyMemoryJobs>(),
  claim: vi.fn<typeof Jobs.claimMemoryJob>(),
  checkpoint: vi.fn<typeof Jobs.checkpointMemoryJob>(),
  publish: vi.fn<typeof Jobs.publishMemoryJob>(),
  release: vi.fn<typeof Jobs.releaseMemoryJob>(),
  defer: vi.fn<typeof Jobs.deferMemoryJob>(),
  reject: vi.fn<typeof Jobs.rejectMemoryJob>(),
  reserve: vi.fn<typeof Artifacts.registerMemoryJobArtifacts>(),
  purges: vi.fn<typeof Artifacts.listPendingMemoryBlobPurges>(),
  claimPurge: vi.fn<typeof Artifacts.claimMemoryBlobPurge>(),
  completePurge: vi.fn<typeof Artifacts.completeMemoryBlobPurge>(),
  extract: vi.fn<typeof reconcileKnowledge>(),
  recovery: vi.fn<() => Promise<void>>(),
  put: vi.fn<typeof Blob.put>(),
  del: vi.fn<typeof Blob.del>(),
}));
vi.mock("@db/services/memory/jobs", () => ({
  listReadyMemoryJobs: mocks.ready,
  claimMemoryJob: mocks.claim,
  checkpointMemoryJob: mocks.checkpoint,
  publishMemoryJob: mocks.publish,
  releaseMemoryJob: mocks.release,
  deferMemoryJob: mocks.defer,
  rejectMemoryJob: mocks.reject,
}));
vi.mock("@db/services/memory/artifacts", () => ({
  registerMemoryJobArtifacts: mocks.reserve,
  listPendingMemoryBlobPurges: mocks.purges,
  claimMemoryBlobPurge: mocks.claimPurge,
  completeMemoryBlobPurge: mocks.completePurge,
}));
vi.mock("@db/services/memory/records", () => ({
  followMemoryLinks: mocks.links,
}));
vi.mock("@db/services/memory/scope", () => ({ readMemoryState: mocks.state }));
vi.mock("@vercel/blob", () => ({ put: mocks.put, del: mocks.del }));
vi.mock("@shared/environment", () => ({
  env: {
    get KNOWLEDGE_MEMORY_MODE() {
      return mocks.mode;
    },
  },
}));
vi.mock("@shared/memory/config", () => ({
  knowledgeMemoryModeForWorkspace: () => mocks.mode,
}));
vi.mock("@agent/lib/schedules/request", () => ({
  postMemoryRecovery: mocks.recovery,
}));
vi.mock("./reconcile", () => ({ reconcileKnowledge: mocks.extract }));
import { maintainKnowledge } from "./maintenance";

const scope = { workspaceId: "workspace", userId: "user" };
const content = {
  kind: "preference" as const,
  title: "Quiet trains",
  body: "I prefer quiet train cars.",
  aliases: [],
  status: "active" as const,
  evidence: [{ sourceId: "source", start: 0, end: 25 }],
  effectiveAt: null,
  expiresAt: null,
};
const job = {
  id: "job",
  workspaceId: scope.workspaceId,
  scopeKey: "key",
  requestedByUserId: scope.userId,
  status: "running",
  attempts: 1,
  epoch: 0,
  publishedGeneration: null,
  sourceVersions: [],
  checkpoint: null,
  leaseToken: "lease",
  leaseExpiresAt: new Date(Date.now() + 120_000),
  availableAt: new Date(),
  createdAt: new Date(),
  sources: [],
  exportRecords: [{ id: "record", revision: 1, content }],
} satisfies NonNullable<Awaited<ReturnType<typeof Jobs.claimMemoryJob>>>;
const artifact = {
  workspaceId: scope.workspaceId,
  scopeKey: "key",
  pathname: "memory/job/lease/old.md",
  jobId: "job",
  userId: scope.userId,
  sha256: "a".repeat(64),
  recordId: "record",
  revision: 1,
  status: "purge" as const,
  createdAt: new Date(0),
  scope,
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.mode = "enabled";
  mocks.links.mockResolvedValue({ links: [], records: [] });
  mocks.state.mockResolvedValue({
    workspaceId: scope.workspaceId,
    scopeKey: "key",
    deletionEpoch: 0,
    generation: 7,
    inputRevision: 1,
    forgetBefore: null,
  });
  mocks.ready.mockResolvedValue([{ scope, scopeKey: "key", id: job.id }]);
  mocks.claim.mockResolvedValue(job);
  mocks.purges.mockResolvedValue([]);
  mocks.reserve.mockImplementation(
    async (_scope, _key, _id, _lease, artifacts) => [...artifacts]
  );
});

describe("durable knowledge maintenance", () => {
  it("defers budget exhaustion without checkpointing, retrying, or publishing", async () => {
    const retryAt = new Date("2026-10-22T00:00:00Z");
    mocks.claim.mockResolvedValue({
      ...job,
      exportRecords: [],
      sources: [
        {
          id: "source",
          workspaceId: scope.workspaceId,
          scopeKey: "key",
          kind: "user",
          text: content.body,
          reference: null,
          sessionId: "session",
          turnId: "turn",
          observedAt: new Date(),
          version: 1,
          status: "pending",
          createdAt: new Date(),
        },
      ],
    });
    mocks.extract.mockRejectedValue(new MemoryBudgetExceededError(retryAt));
    await maintainKnowledge();
    expect(mocks.defer).toHaveBeenCalledWith(
      scope,
      "key",
      "job",
      "lease",
      retryAt
    );
    expect(mocks.release).not.toHaveBeenCalled();
    expect(mocks.checkpoint).not.toHaveBeenCalled();
    expect(mocks.put).not.toHaveBeenCalled();
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it("rejects an input that cannot fit a positive daily allowance instead of deferring forever", async () => {
    mocks.claim.mockResolvedValue({
      ...job,
      exportRecords: [],
      sources: [
        {
          id: "source",
          workspaceId: scope.workspaceId,
          scopeKey: "key",
          kind: "user",
          text: content.body,
          reference: null,
          sessionId: "session",
          turnId: "turn",
          observedAt: new Date(),
          version: 1,
          status: "pending",
          createdAt: new Date(),
        },
      ],
    });
    mocks.extract.mockRejectedValue(new MemoryRequestTooLargeError());
    await maintainKnowledge();
    expect(mocks.reject).toHaveBeenCalledWith(scope, "key", "job", "lease");
    expect(mocks.defer).not.toHaveBeenCalled();
    expect(mocks.release).not.toHaveBeenCalled();
    expect(mocks.checkpoint).not.toHaveBeenCalled();
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it("exports authoritative existing links supported by both endpoint records", async () => {
    mocks.links.mockResolvedValue({
      links: [
        {
          workspaceId: scope.workspaceId,
          scopeKey: "key",
          fromId: "record",
          toId: "existing",
          relation: "co-mentioned",
        },
      ],
      records: [
        {
          id: "existing",
          revision: 1,
          content,
          explicit: false,
          updatedAt: new Date().toISOString(),
        },
      ],
    });
    await maintainKnowledge();
    expect(mocks.put).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining("memory:record/existing"),
      expect.anything()
    );
  });

  it("discards a stale publication checkpoint so the next attempt can reconcile fresh revisions", async () => {
    mocks.publish.mockRejectedValue(new Error("Generation changed"));
    await maintainKnowledge();
    expect(mocks.release).toHaveBeenCalledWith(scope, "key", "job", "lease", {
      discardCheckpoint: true,
    });
  });

  it("writes only evidence-supported logical links and drops old edges when correcting a record", async () => {
    const records = [
      { id: "record", expectedRevision: 1, content },
      { id: "related", expectedRevision: 0, content },
      {
        id: "unsupported",
        expectedRevision: 0,
        content: {
          ...content,
          evidence: [{ sourceId: "different", start: 0, end: 25 }],
        },
      },
    ];
    mocks.claim.mockResolvedValue({
      ...job,
      exportRecords: [],
      checkpoint: {
        records,
        links: [
          { fromId: "record", toId: "related", relation: "co-mentioned" },
          { fromId: "record", toId: "unsupported", relation: "co-mentioned" },
        ],
      },
    });
    mocks.links.mockResolvedValue({
      links: [
        {
          workspaceId: scope.workspaceId,
          scopeKey: "key",
          fromId: "record",
          toId: "old",
          relation: "co-mentioned",
        },
      ],
      records: [
        {
          id: "old",
          revision: 1,
          content,
          explicit: false,
          updatedAt: new Date().toISOString(),
        },
      ],
    });
    await maintainKnowledge();
    const markdown = mocks.put.mock.calls
      .map((call) => z.string().parse(call[1]))
      .find((body) => body.includes('"id": "record"'));
    expect(markdown).toContain("memory:record/related");
    expect(markdown).not.toContain("memory:record/unsupported");
    expect(markdown).not.toContain("memory:record/old");
  });

  it("exports explicit records without a model, reserving private immutable paths before atomic publication", async () => {
    await maintainKnowledge();
    expect(mocks.extract).not.toHaveBeenCalled();
    expect(mocks.reserve.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.put.mock.invocationCallOrder[0] ?? 0
    );
    expect(mocks.put.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.publish.mock.invocationCallOrder[0] ?? 0
    );
    expect(mocks.put).toHaveBeenCalledWith(
      expect.stringMatching(/^memory\/[^/]+\/job\/lease\/[a-f0-9]{64}\.md$/u),
      expect.stringContaining('"revision": 1'),
      expect.objectContaining({ access: "private", addRandomSuffix: false })
    );
    expect(mocks.publish).toHaveBeenCalledWith(
      scope,
      "key",
      expect.objectContaining({
        records: [],
        expectedEpoch: 0,
        expectedGeneration: 7,
        leaseToken: "lease",
        artifacts: [
          expect.objectContaining({ recordId: "record", revision: 1 }),
        ],
      })
    );
  });

  it("reuses a durable extraction checkpoint after retry instead of spending another model call", async () => {
    const checkpoint = {
      records: [{ id: "record", expectedRevision: 0, content }],
      links: [],
    };
    mocks.claim.mockResolvedValue({ ...job, checkpoint, exportRecords: [] });
    await maintainKnowledge();
    expect(mocks.extract).not.toHaveBeenCalled();
    expect(mocks.checkpoint).not.toHaveBeenCalled();
    expect(mocks.publish).toHaveBeenCalledWith(
      scope,
      "key",
      expect.objectContaining(checkpoint)
    );
  });

  it("releases failed uploads for retry without publishing a partial generation", async () => {
    mocks.put.mockRejectedValue(new Error("Upload unavailable"));
    await maintainKnowledge();
    expect(mocks.release).toHaveBeenCalledWith(scope, "key", "job", "lease", {
      discardCheckpoint: false,
    });
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it("runs queued deletion when disabled and fences it before physical deletion", async () => {
    mocks.mode = "off";
    mocks.purges.mockResolvedValue([artifact]);
    mocks.claimPurge.mockResolvedValue(artifact);
    await maintainKnowledge();
    expect(mocks.recovery).not.toHaveBeenCalled();
    expect(mocks.ready).not.toHaveBeenCalled();
    expect(mocks.claimPurge.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.del.mock.invocationCallOrder[0] ?? 0
    );
    expect(mocks.completePurge).toHaveBeenCalledWith(
      scope,
      "key",
      artifact.pathname
    );
  });

  it("keeps the durable purge item when physical deletion fails and skips unclaimed artifacts", async () => {
    mocks.mode = "off";
    mocks.purges.mockResolvedValue([artifact]);
    mocks.claimPurge.mockResolvedValue(null);
    await maintainKnowledge();
    expect(mocks.del).not.toHaveBeenCalled();
    mocks.claimPurge.mockResolvedValue(artifact);
    mocks.del.mockRejectedValue(new Error("Storage unavailable"));
    await maintainKnowledge();
    expect(mocks.completePurge).not.toHaveBeenCalled();
  });
});
