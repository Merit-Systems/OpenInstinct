import { defineHook } from "eve/hooks";
import { coordinatorTaskRoster } from "../lib/coordinator-task-roster";

export default defineHook({
  events: {
    "actions.requested"(event) {
      for (const action of event.data.actions) {
        if (
          action.kind !== "subagent-call" ||
          action.subagentName !== "coordinator" ||
          typeof action.input.message !== "string"
        ) {
          continue;
        }

        const firstLine = action.input.message
          .split(/\r?\n/u)
          .map((line) => line.trim())
          .find(Boolean)
          ?.replace(/^Task:\s*/iu, "");
        if (!firstLine) continue;

        const task = {
          summary: firstLine.slice(0, 120),
          updatedAt: event.meta.at,
        };
        coordinatorTaskRoster.update((current) => ({
          pendingByCallId: {
            ...current.pendingByCallId,
            [action.callId]: task,
          },
          tasksByAgentId:
            typeof action.input.agentId === "string"
              ? {
                  ...current.tasksByAgentId,
                  [action.input.agentId]: task,
                }
              : current.tasksByAgentId,
        }));
      }
    },
    "subagent.completed"(event) {
      if (
        event.data.subagentName !== "coordinator" ||
        event.data.backgroundTask === undefined
      ) {
        return;
      }

      let agentId: string | undefined;
      try {
        const receipt: unknown = JSON.parse(event.data.output);
        if (
          typeof receipt === "object" &&
          receipt !== null &&
          "agentId" in receipt &&
          typeof receipt.agentId === "string"
        ) {
          agentId = receipt.agentId;
        }
      } catch {
        return;
      }
      if (!agentId) return;

      coordinatorTaskRoster.update((current) => {
        const task = current.pendingByCallId[event.data.callId];
        if (!task) return current;
        return {
          pendingByCallId: Object.fromEntries(
            Object.entries(current.pendingByCallId).filter(
              ([callId]) => callId !== event.data.callId
            )
          ),
          tasksByAgentId: { ...current.tasksByAgentId, [agentId]: task },
        };
      });
    },
  },
});
