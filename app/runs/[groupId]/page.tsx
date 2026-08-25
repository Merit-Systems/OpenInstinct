import { BrowserRunDetail } from "@/app/_components/browser-run-detail";

export default async function BrowserRunPage({
  params,
}: {
  readonly params: Promise<{ readonly groupId: string }>;
}) {
  const { groupId } = await params;
  return <BrowserRunDetail groupId={groupId} />;
}
