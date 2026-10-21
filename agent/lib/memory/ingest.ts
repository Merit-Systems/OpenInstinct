import { createHash } from "node:crypto";
import type { ModelMessage } from "ai";
import { captureMemorySource } from "@db/services/memory/sources";
import type { AccessScope } from "@shared/identity/access-scope";
import { knowledgeMemoryModeForWorkspace } from "@shared/memory/config";
import { eligibleKnowledgeText } from "@shared/memory/policy";
export {
  eligibleKnowledgeText,
  hasKnowledgeEditIntent,
} from "@shared/memory/policy";
import type { MemorySourceInput } from "@shared/memory/schema";

export function knowledgeInputIdentity(
  sessionId: string,
  turnId: string,
  text: string
) {
  return `input-${createHash("sha256")
    .update(JSON.stringify([sessionId, turnId, text]))
    .digest("hex")}`;
}

export function directKnowledgeInputs(messages: readonly ModelMessage[]) {
  return messages.flatMap((message) => {
    if (
      message.role !== "user" ||
      !("kind" in message) ||
      message.kind !== "user"
    )
      return [];
    const text = !Array.isArray(message.content)
      ? message.content
      : message.content
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n");
    return text ? [text] : [];
  });
}

export function knowledgeInputSource(input: {
  readonly sessionId: string;
  readonly turnId: string;
  readonly text: string;
  readonly observedAt: string;
  readonly sensitive?: boolean;
  readonly kind?: "execution.background_task";
  readonly eventId?: string;
}) {
  if (input.kind || input.sensitive || !eligibleKnowledgeText(input.text))
    return null;
  const id = knowledgeInputIdentity(input.sessionId, input.turnId, input.text);
  return {
    id,
    kind: "user",
    text: input.text,
    reference: input.eventId
      ? `session:${input.sessionId}:turn:${input.turnId}:event:${input.eventId}`
      : `session:${input.sessionId}:turn:${input.turnId}`,
    sessionId: input.sessionId,
    turnId: input.turnId,
    observedAt: input.observedAt,
    sensitive: false,
    excluded: false,
  } satisfies MemorySourceInput;
}

export async function captureKnowledgeInput(
  input: Parameters<typeof knowledgeInputSource>[0] & {
    readonly scope: AccessScope;
    readonly scopeKey: string;
  }
) {
  if (knowledgeMemoryModeForWorkspace(input.scope.workspaceId) === "off")
    return null;
  const source = knowledgeInputSource(input);
  return source
    ? captureMemorySource(input.scope, input.scopeKey, source, source.id)
    : null;
}
