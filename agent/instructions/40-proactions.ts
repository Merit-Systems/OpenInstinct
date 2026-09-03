import { defineDynamic, defineInstructions } from "eve/instructions";
import { proactionIdentity } from "@/agent/lib/proactions/identity";
import proactionReport from "./content/role/proaction-report.md?raw";
import proactionWorker from "./content/role/proaction-worker.md?raw";

export default defineDynamic({
  events: {
    "turn.started": (_event, context) => {
      const identity = proactionIdentity(context.session.auth);
      if (!identity) return null;
      return defineInstructions({
        content: identity.role === "worker" ? proactionWorker : proactionReport,
      });
    },
  },
});
