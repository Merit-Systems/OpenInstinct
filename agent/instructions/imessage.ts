import { defineDynamic, defineInstructions } from "eve/instructions";

export default defineDynamic({
  events: {
    "turn.started": (_event, context) =>
      context.channel.kind === "channel:linq"
        ? defineInstructions({
            content: `You are replying in iMessage. The react_to_message tool adds a native tapback to the user's latest message. Decide whether a reaction is natural; never react automatically to every message. Use a reaction by itself when it fully communicates acknowledgment, agreement, amusement, support, emphasis, or a question. When words add value, send a concise text reply and react only if the tapback genuinely complements it. Never claim that you cannot react when this tool is available, and never narrate a reaction instead of using the tool.`,
          })
        : null,
  },
});
