import type { EveMessage } from "eve/react";
import { describe, expect, it } from "vitest";
import {
  matchesApprovalOption,
  pendingApprovalRequests,
} from "./pending-approvals";

const approval = (requestId: string, answered = false) => {
  const inputResponse = answered
    ? { optionId: "approve", requestId }
    : undefined;
  return {
    id: `assistant-${requestId}`,
    metadata: { status: "streaming" },
    parts: [
      {
        approval: { id: requestId },
        input: { to: ["a@example.com"] },
        state: answered ? "approval-responded" : "approval-requested",
        stepIndex: 0,
        toolCallId: `call-${requestId}`,
        toolMetadata: {
          eve: {
            inputRequest: {
              kind: "tool-approval",
              options: [
                { id: "approve", label: "Approve" },
                { id: "cancel", label: "Cancel" },
              ],
              prompt: "Approve tool call: gmail-send",
              requestId,
            },
            inputResponse,
            kind: "tool-call",
            name: "gmail-send",
          },
        },
        toolName: "gmail-send",
        type: "dynamic-tool",
      },
    ],
    role: "assistant",
  } satisfies EveMessage;
};

describe("pending approvals", () => {
  it("collects only unanswered approval requests", () => {
    const requests = pendingApprovalRequests([
      approval("a"),
      approval("b", true),
    ]);
    expect(requests.map((request) => request.requestId)).toEqual(["a"]);
  });

  it("recognizes text the runtime would treat as an approval response", () => {
    const requests = pendingApprovalRequests([approval("a")]);
    for (const text of ["1", "2", "approve", " Cancel ", "APPROVE"]) {
      expect(matchesApprovalOption(text, requests)).toBe(true);
    }
    expect(matchesApprovalOption("3", requests)).toBe(false);
    expect(matchesApprovalOption("please wait", requests)).toBe(false);
    expect(matchesApprovalOption("1", [])).toBe(false);
  });
});
