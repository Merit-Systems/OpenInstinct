import { defineDynamic } from "eve/instructions";
import executionSafety from "./content/execution-safety/prompt.md?raw";
import { resolveModeInstructions } from "./content/mode";

export default defineDynamic({
  events: {
    "turn.started": (_event, context) =>
      resolveModeInstructions(context, {
        interactive: executionSafety,
        "scheduled-worker": executionSafety,
      }),
  },
});
