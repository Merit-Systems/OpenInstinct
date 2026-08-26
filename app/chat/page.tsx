import { AgentChat } from "@/app/_components/agent-chat";
import { ManagerShell } from "@/app/_components/manager-shell";

export default function NewChatPage() {
  return (
    <ManagerShell active="chat">
      <AgentChat sessionless />
    </ManagerShell>
  );
}
