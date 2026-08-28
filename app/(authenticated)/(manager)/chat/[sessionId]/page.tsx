import { AgentChat } from "../_components/agent-chat";
import { readChat } from "@/db/services/chats";
import { requireRequestScope } from "@/lib/request-scope";

export default async function ChatSessionPage({
  params,
}: PageProps<"/chat/[sessionId]">) {
  const { sessionId } = await params;
  const scope = await requireRequestScope();
  const chat = await readChat(scope, sessionId);
  return <AgentChat initialUsage={chat?.usage} sessionId={sessionId} />;
}
