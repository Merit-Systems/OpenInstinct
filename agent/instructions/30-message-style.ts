import { defineDynamic } from "eve/instructions";
import messageStyle from "./content/message-style.md?raw";
import { resolveModeInstructions } from "./content/mode";

export default defineDynamic({
  events: {
    "turn.started": (_event, context) =>
      resolveModeInstructions(context, {
        interactive: messageStyle,
        "scheduled-report": messageStyle,
      }),
  },
});
