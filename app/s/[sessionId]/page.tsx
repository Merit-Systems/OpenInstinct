import { redirect } from "next/navigation";

export default async function SessionPage({
  params,
}: {
  readonly params: Promise<{ readonly sessionId: string }>;
}) {
  const { sessionId } = await params;
  redirect(`/chat/${encodeURIComponent(sessionId)}`);
}
