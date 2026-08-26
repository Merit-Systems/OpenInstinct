import { AgentChat } from "@/app/_components/agent-chat";
import { ManagerShell } from "@/app/_components/manager-shell";

export default async function ChatSessionPage({
  params,
}: {
  readonly params: Promise<{ readonly sessionId: string }>;
}) {
  const { sessionId } = await params;
  return (
    <ManagerShell active="chat">
      <AgentChat sessionId={sessionId} />
    </ManagerShell>
  );
}
