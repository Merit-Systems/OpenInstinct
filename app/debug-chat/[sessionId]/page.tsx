import { notFound } from "next/navigation";
import { DebugAgentChat } from "@/app/_components/debug-agent-chat";
import { getEnv } from "@/lib/runtime-env";

export const dynamic = "force-dynamic";

export default async function DebugChatSessionPage({
  params,
}: {
  readonly params: Promise<{ readonly sessionId: string }>;
}) {
  if (getEnv().NODE_ENV !== "development") notFound();

  const { sessionId } = await params;
  if (!sessionId.trim()) notFound();

  return <DebugAgentChat sessionId={sessionId} />;
}
