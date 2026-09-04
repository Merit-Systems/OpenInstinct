import type {
  CancelSessionResult,
  InputResponse,
  MessageStreamEvent,
  RespondTurnOptions,
  SendTurnOptions,
} from "eve/client";
import type { EveMessageData, UseEveAgentStatus } from "eve/react";
import type { UserContent } from "ai";

export interface ChatAgent {
  readonly cancel: () => Promise<CancelSessionResult>;
  readonly data: EveMessageData;
  readonly error?: Error;
  readonly events: readonly MessageStreamEvent[];
  readonly hasOlder: boolean;
  readonly isLoadingOlder: boolean;
  readonly loadOlder: () => Promise<void>;
  readonly respond: <TOutput = unknown>(
    inputResponses: readonly InputResponse[],
    options?: RespondTurnOptions<TOutput>
  ) => Promise<void>;
  readonly resume: () => Promise<void>;
  readonly send: <TOutput = unknown>(
    message: string | UserContent,
    options?: SendTurnOptions<TOutput>
  ) => Promise<void>;
  readonly status: UseEveAgentStatus;
}
