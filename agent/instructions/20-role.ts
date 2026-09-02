import { defineDynamic } from "eve/instructions";
import interactiveInstructions from "./content/role/interactive.md?raw";
import { resolveModeInstructions } from "./content/mode";
import scheduledReportInstructions from "./content/role/scheduled-report.md?raw";
import scheduledWorkerInstructions from "./content/role/scheduled-worker.md?raw";

export default defineDynamic({
  events: {
    "turn.started": (_event, context) =>
      resolveModeInstructions(context, {
        interactive: interactiveInstructions,
        "scheduled-report": scheduledReportInstructions,
        "scheduled-worker": scheduledWorkerInstructions,
      }),
  },
});
