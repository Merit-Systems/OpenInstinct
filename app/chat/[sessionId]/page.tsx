import { AgentChat } from "@/app/_components/agent-chat";
import { ManagerShell } from "@/app/_components/manager-shell";
import { getAppStore } from "@/lib/server/database";

export default async function ChatSessionPage({
  params,
}: {
  readonly params: Promise<{ readonly sessionId: string }>;
}) {
  const { sessionId } = await params;
  const chat = (await (await getAppStore()).listChats()).find(
    (candidate) => candidate.sessionId === sessionId
  );
  return (
    <ManagerShell active="chat">
      <AgentChat initialUsage={chat?.usage} sessionId={sessionId} />
    </ManagerShell>
  );
}
