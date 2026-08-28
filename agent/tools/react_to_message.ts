import { defineDynamic, defineTool, toolOutput } from "eve/tools";
import { linqReactionRequestSchema } from "@/agent/lib/linq-reactions";

export const reactToMessageTool = defineTool({
  description:
    "Add a native iMessage tapback to the user's latest message. Use this only when a reaction is a natural conversational choice, never as an automatic acknowledgment. A reaction may replace a text reply when it fully communicates the response.",
  inputSchema: linqReactionRequestSchema,
  outputSchema: linqReactionRequestSchema,
  execute(input) {
    return input;
  },
  toModelOutput({ reaction }) {
    return toolOutput.text(
      `The ${reaction} tapback was added. Do not narrate the reaction or add redundant text.`
    );
  },
});

export default defineDynamic({
  events: {
    "turn.started": (_event, context) =>
      context.channel.kind === "channel:linq" ? reactToMessageTool : null,
  },
});
