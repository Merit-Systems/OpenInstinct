import { AgentChat } from "@/app/_components/agent-chat";
import { ManagerShell } from "@/app/_components/manager-shell";
import { getAppStore } from "@/lib/server/app-store";
import { requireRequestScope } from "@/lib/server/request-scope";

export default async function ChatSessionPage({
  params,
}: {
  readonly params: Promise<{ readonly sessionId: string }>;
}) {
  const { sessionId } = await params;
  const scope = await requireRequestScope();
  const chat = (await (await getAppStore()).listChats(scope)).find(
    (candidate) => candidate.sessionId === sessionId
  );
  return (
    <ManagerShell active="chat">
      <AgentChat initialUsage={chat?.usage} sessionId={sessionId} />
    </ManagerShell>
  );
}
