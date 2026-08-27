import { AgentChat } from "@/app/_components/agent-chat";
import { ManagerShell } from "@/app/_components/manager-shell";
import { readChat } from "@/db/services/chats";
import { requireRequestScope } from "@/lib/server/request-scope";

export default async function ChatSessionPage({
  params,
}: {
  readonly params: Promise<{ readonly sessionId: string }>;
}) {
  const { sessionId } = await params;
  const scope = await requireRequestScope();
  const chat = await readChat(scope, sessionId);
  return (
    <ManagerShell active="chat">
      <AgentChat initialUsage={chat?.usage} sessionId={sessionId} />
    </ManagerShell>
  );
}
