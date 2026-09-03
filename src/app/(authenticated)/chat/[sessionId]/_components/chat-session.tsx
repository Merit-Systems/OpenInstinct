"use client";

import { useState } from "react";
import type { ChatUsage } from "@/lib/chat";
import type { TraceView } from "../_lib/trace-view";
import { SubagentPanel } from "./activity";
import { ChatConversation } from "./conversation";
import { ChatInput } from "./input";
import { useSessionAgent } from "./use-session-agent";

export function ChatSession({
  initialUsage,
  sessionId,
}: {
  readonly initialUsage?: ChatUsage;
  readonly sessionId: string;
}) {
  const [traceView, setTraceView] = useState<TraceView>("imessage");
  const agent = useSessionAgent(sessionId);

  return (
    <div className="relative flex h-full min-h-0 overflow-hidden bg-background text-foreground">
      <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        <ChatConversation
          agent={agent}
          initial={false}
          history={{
            hasOlder: agent.hasOlder,
            isLoadingOlder: agent.isLoadingOlder,
            loadOlder: agent.loadOlder,
          }}
          sessionId={sessionId}
          traceView={traceView}
        />
        <ChatInput agent={agent} sessionId={sessionId} />
      </div>
      <SubagentPanel
        events={agent.events}
        historyComplete={!agent.hasOlder}
        initialUsage={initialUsage}
        onTraceViewChange={setTraceView}
        sessionId={sessionId}
        traceView={traceView}
      />
    </div>
  );
}
