import type { MessageStreamEvent } from "eve/client";
import type { EveMessage, EveMessagePart } from "eve/react";
import { parseMessageContext } from "@shared/chat/message-context";
import { reactToMessageToolResultSchema } from "@shared/chat/reaction";

export interface MessagePresentation {
  parts: readonly EveMessagePart[];
  reactions: readonly string[];
  reply?: {
    text: string;
    targetId?: string;
    image?: Extract<EveMessagePart, { type: "file" }>;
  };
}

export function messagePresentations(
  messages: readonly EveMessage[],
  events: readonly MessageStreamEvent[]
) {
  const presentations = new Map<string, MessagePresentation>();
  const references = new Map<
    string,
    {
      id: string;
      presentation: MessagePresentation;
      context: ReturnType<typeof readContext>;
    }
  >();
  for (const message of messages) {
    if (message.role !== "user") continue;
    const context = readContext(message.parts);
    const presentation: MessagePresentation = {
      parts: context ? message.parts.slice(1) : message.parts,
      reactions: [],
    };
    presentations.set(message.id, presentation);
    const reference = { id: message.id, presentation, context };
    references.set(message.id, reference);
    if (context) references.set(context.messageId, reference);
  }
  for (const message of messages) {
    const context = readContext(message.parts);
    const presentation = presentations.get(message.id);
    if (!context?.replyTo || !presentation) continue;
    const target = references.get(context.replyTo.messageId);
    const partIndex = context.replyTo.partIndex ?? 0;
    const part = target?.context?.parts?.find(
      (item) => item.partIndex === partIndex
    );
    // Repeated URLs represent distinct provider parts; select the same occurrence.
    const occurrence =
      target?.context?.parts?.filter(
        (item) =>
          item.partIndex < partIndex &&
          part?.url !== undefined &&
          item.url === part.url
      ).length ?? 0;
    const image = target?.presentation.parts.filter(
      (item): item is Extract<EveMessagePart, { type: "file" }> =>
        item.type === "file" &&
        part?.url !== undefined &&
        item.url === part.url &&
        item.mediaType.startsWith("image/")
    )[occurrence];
    const body = target?.presentation.parts.find(
      (item) => item.type === "text"
    );
    presentation.reply = {
      targetId: target?.id,
      text:
        image?.filename ??
        part?.value ??
        (body?.type === "text" ? body.text : "Earlier message"),
      image,
    };
  }
  const handledReactionCallIds = new Set<string>();
  for (const event of events) {
    // Eve user rows use receipt IDs; older tools used turn IDs. Resolve the
    // latest receipt before each action, including inputs steering one turn.
    if (event.type === "message.received") {
      const turnId = `${event.data.turnId}:user`;
      const reference =
        references.get(`${event.meta.id}:user`) ?? references.get(turnId);
      if (reference) references.set(turnId, reference);
      continue;
    }
    if (event.type !== "action.result" || event.data.status !== "completed")
      continue;
    const result = reactToMessageToolResultSchema.safeParse(event.data.result);
    if (!result.success) continue;
    const { output } = result.data;
    // A provider reaction is attached to its target, never a standalone send.
    // Keep it off unrelated rows while its target is outside loaded history.
    if ("messageId" in output)
      handledReactionCallIds.add(event.data.result.callId);
    const target = references.get(
      "messageId" in output ? output.messageId : `${event.data.turnId}:user`
    );
    if (!target) continue;
    handledReactionCallIds.add(event.data.result.callId);
    target.presentation.reactions = target.presentation.reactions.filter(
      (emoji) => emoji !== output.emoji
    );
    if (output.operation === "add")
      target.presentation.reactions = [
        ...target.presentation.reactions,
        output.emoji,
      ];
  }
  return { presentations, handledReactionCallIds };
}

function readContext(parts: readonly EveMessagePart[]) {
  const first = parts[0];
  if (first?.type !== "text" || parts.length < 2) return undefined;
  if (
    !parts
      .slice(1)
      .some(
        (part) =>
          part.type === "file" || (part.type === "text" && part.text.trim())
      )
  )
    return undefined;
  const context = parseMessageContext(first.text);
  if (!context) return undefined;
  // Attachment-only ingress must bind its provider references to the files.
  // Pasted headers, empty Parts arrays, and unrelated parts stay ordinary text.
  const body = parts.slice(1);
  if (!body.some((part) => part.type === "text" && part.text.trim())) {
    const files = body.filter((part) => part.type === "file");
    if (
      !context.parts?.length ||
      !files.length ||
      !files.every(
        (file) =>
          file.url !== undefined &&
          context.parts?.some((part) => part.url === file.url)
      )
    )
      return undefined;
  }
  return context;
}
