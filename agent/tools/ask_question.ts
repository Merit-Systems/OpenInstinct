import { defineDynamic } from "eve/tools";
import { askQuestion } from "eve/tools/ask_question";
import { resolveModeValue } from "@/agent/lib/mode";

export default defineDynamic({
  events: {
    "turn.started": (_event, context) =>
      resolveModeValue(context, { "scheduled-worker": askQuestion }),
  },
});
