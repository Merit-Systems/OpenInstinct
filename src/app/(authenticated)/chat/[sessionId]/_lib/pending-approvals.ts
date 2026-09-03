import type { EveMessage, EveMessageInputRequest } from "eve/react";

export function pendingApprovalRequests(messages: readonly EveMessage[]) {
  return messages.flatMap((message) =>
    message.parts.flatMap((part) => {
      if (part.type !== "dynamic-tool") return [];
      const eve = part.toolMetadata?.eve;
      return eve?.inputRequest?.kind === "tool-approval" &&
        eve.inputResponse === undefined
        ? [eve.inputRequest]
        : [];
    })
  );
}

/**
 * The runtime settles a pending approval from a plain message that matches an
 * option id, label, or 1-based index, and applies one message to every pending
 * request. Detect that shape so the client can require the explicit control.
 */
export function matchesApprovalOption(
  text: string,
  requests: readonly EveMessageInputRequest[]
) {
  const normalized = text.trim().toLowerCase();
  if (normalized.length === 0) return false;
  return requests.some((request) =>
    (request.options ?? []).some(
      (option, index) =>
        option.id.toLowerCase() === normalized ||
        option.label.toLowerCase() === normalized ||
        String(index + 1) === normalized
    )
  );
}
