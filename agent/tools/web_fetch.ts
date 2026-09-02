import webFetchDefinition from "eve/tools/web_fetch";
import { defineDynamic } from "eve/tools";
import { resolveModeValue } from "../lib/mode";

export default defineDynamic({
  events: {
    "turn.started": (_event, context) =>
      resolveModeValue(context, {
        interactive: webFetchDefinition,
        "scheduled-worker": webFetchDefinition,
      }),
  },
});
