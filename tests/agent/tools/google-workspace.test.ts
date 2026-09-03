import type { ToolContext } from "eve/tools";
import { describe, expect, it, vi } from "vitest";
import type * as GmailModule from "@/agent/lib/google-workspace/gmail";
import type { updateGmail } from "@/agent/lib/google-workspace/gmail";

const gmail = vi.hoisted(() => ({
  update: vi
    .fn<typeof updateGmail>()
    .mockResolvedValue({ action: "archive", updatedCount: 2 }),
}));

vi.mock("@/agent/lib/google-workspace/gmail", async (importOriginal) => ({
  ...(await importOriginal<typeof GmailModule>()),
  updateGmail: gmail.update,
}));

import { gmailUpdate, gmailUpdateApproval } from "@/agent/tools/gmail";

describe("Google Workspace tools", () => {
  it("reports the selected Gmail update without an action discriminator", async () => {
    const context = toolContext();
    const result = await gmailUpdate.execute(
      { messageIds: ["message-1", "message-2"], update: "archive" },
      context
    );

    expect(gmail.update).toHaveBeenCalledExactlyOnceWith(
      context,
      ["message-1", "message-2"],
      "archive"
    );
    expect(result).toEqual({ update: "archive", updatedCount: 2 });
  });

  it("requires approval before hiding more than one message from the inbox", () => {
    expect(gmailUpdateApproval({ messageIds: ["m1"], update: "archive" })).toBe(
      "not-applicable"
    );
    expect(
      gmailUpdateApproval({ messageIds: ["m1", "m2"], update: "mark_read" })
    ).toBe("user-approval");
    expect(
      gmailUpdateApproval({ messageIds: ["m1", "m2", "m3"], update: "star" })
    ).toBe("not-applicable");
    expect(
      gmailUpdateApproval({
        messageIds: Array.from(
          { length: 11 },
          (_, index) => `m${String(index)}`
        ),
        update: "star",
      })
    ).toBe("user-approval");
    expect(gmailUpdateApproval(undefined)).toBe("user-approval");
  });
});

function toolContext() {
  return {
    abortSignal: new AbortController().signal,
    callId: "call-1",
    async getSandbox() {
      throw new Error("Sandbox access is outside this focused test.");
    },
    getSkill() {
      throw new Error("Skill access is outside this focused test.");
    },
    async getToken() {
      throw new Error("Token access is outside this focused test.");
    },
    requireAuth() {
      throw new Error("Authorization is outside this focused test.");
    },
    session: {
      auth: { current: null, initiator: null },
      id: "session-1",
      turn: { id: "turn-1", sequence: 0 },
    },
    toolName: "gmail-update",
  } satisfies ToolContext;
}
