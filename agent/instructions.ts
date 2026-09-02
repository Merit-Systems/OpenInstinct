import { defineDynamic, defineInstructions } from "eve/instructions";
import interactiveInstructions from "../prompts/instructions/interactive.md?raw";
import scheduledReportInstructions from "../prompts/instructions/scheduled-report.md?raw";
import scheduledWorkerInstructions from "../prompts/instructions/scheduled-worker.md?raw";

export default defineDynamic({
  events: {
    "turn.started": (_event, context) => {
      const caller =
        context.session.auth.current ?? context.session.auth.initiator;
      const content =
        caller?.authenticator === "scheduled-worker"
          ? scheduledWorkerInstructions
          : caller?.authenticator === "scheduled-result"
            ? scheduledReportInstructions
            : interactiveInstructions;
      return defineInstructions({ content });
    },
  },
});
