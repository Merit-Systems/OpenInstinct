import { defineDynamic } from "eve/instructions";
import { resolveModeInstructions } from "@agent/lib/mode";
import executionSafety from "./content/execution-safety.md?raw";

export default defineDynamic({
  events: {
    "turn.started": (_event, context) =>
      resolveModeInstructions(context, {
        interactive: executionSafety,
        "scheduled-worker": executionSafety,
      }),
  },
});
