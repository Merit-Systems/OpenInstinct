import type { InputResponse } from "eve/client";

export type RespondToAgentInput = (
  responses: readonly InputResponse[]
) => void | Promise<void>;
