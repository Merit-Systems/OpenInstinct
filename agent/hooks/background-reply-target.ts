import { defineHook } from "eve/hooks";
import { registerBackgroundReplyTarget } from "@agent/lib/reply-targets";

export default defineHook({
  events: {
    "subagent.completed"(event, context) {
      const task = event.data.backgroundTask;
      if (!task) return;
      registerBackgroundReplyTarget(task.taskId, context.session.auth);
    },
  },
});
