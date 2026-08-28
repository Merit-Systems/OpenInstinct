import { notFound } from "next/navigation";
import { DebugAgentChat } from "@/app/_components/debug-agent-chat";
import { getEnv } from "@/lib/runtime-env";

export const dynamic = "force-dynamic";

export default function DebugChatPage() {
  if (getEnv().NODE_ENV !== "development") notFound();

  return <DebugAgentChat />;
}
