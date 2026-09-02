import taskCancelDefinition from "eve/tools/task_cancel";
import { defineDynamic } from "eve/tools";
import { resolveModeValue } from "../lib/mode";

export default defineDynamic({
  events: {
    "turn.started": (_event, context) =>
      resolveModeValue(context, {
        interactive: taskCancelDefinition,
        "scheduled-worker": taskCancelDefinition,
      }),
  },
});
