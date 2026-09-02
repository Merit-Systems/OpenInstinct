import { defineDynamic } from "eve/instructions";
import { resolveModeInstructions } from "@/agent/lib/mode";
import workerCoordination from "./content/worker-coordination.md?raw";

export default defineDynamic({
  events: {
    "turn.started": (_event, context) =>
      resolveModeInstructions(context, {
        interactive: workerCoordination,
        "scheduled-worker": workerCoordination,
      }),
  },
});
