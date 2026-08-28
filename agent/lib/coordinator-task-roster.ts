import { defineState } from "eve/context";

export interface CoordinatorTaskSummary {
  readonly summary: string;
  readonly updatedAt: string;
}

export const coordinatorTaskRoster = defineState<{
  readonly pendingByCallId: Readonly<Record<string, CoordinatorTaskSummary>>;
  readonly tasksByAgentId: Readonly<Record<string, CoordinatorTaskSummary>>;
}>("openinstinct.coordinator-task-roster", () => ({
  pendingByCallId: {},
  tasksByAgentId: {},
}));
