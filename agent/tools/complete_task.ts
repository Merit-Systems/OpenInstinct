import { defineTool } from "eve/tools";
import { taskCompletionSchema } from "@/lib/task-completion";

export default defineTool({
  description:
    "Finish the current browser job exactly once with its success or failure status and a concise coordinator-facing terminal message.",
  inputSchema: taskCompletionSchema,
  outputSchema: taskCompletionSchema,
  execute(completion) {
    return completion;
  },
});
