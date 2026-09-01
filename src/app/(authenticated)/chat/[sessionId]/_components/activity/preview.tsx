import type { MessageStreamEvent } from "eve/client";
import { SparklesIcon, XIcon } from "lucide-react";
import type { RefObject } from "react";
import type {
  SubagentSession,
  SubagentStatus,
} from "@/app/_lib/subagent-sessions";
import { Button } from "@/components/ui/button";
import { agentLabel } from "./presentation";
import { SubagentTrace } from "./trace";

export function TracePreview({
  closeButtonRef,
  events,
  onClose,
  session,
  status,
  streamError,
}: {
  readonly closeButtonRef?: RefObject<HTMLButtonElement | null>;
  readonly events: readonly MessageStreamEvent[];
  readonly onClose: () => void;
  readonly session: SubagentSession;
  readonly status: SubagentStatus;
  readonly streamError?: string;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
        <SparklesIcon className="size-4 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate type-card-title">
            {agentLabel(session.name)}
          </h2>
          <p className="truncate type-caption text-muted-foreground">
            Full task trace
          </p>
        </div>
        <Button
          aria-label="Close task trace"
          onClick={onClose}
          ref={closeButtonRef}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <XIcon />
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 sm:px-6">
        <SubagentTrace
          events={events}
          status={status}
          streamError={streamError}
          target={session}
        />
      </div>
    </div>
  );
}
