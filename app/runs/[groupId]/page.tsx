import { BrowserRunDetail } from "@/app/_components/browser-run-detail";
import { ManagerShell } from "@/app/_components/manager-shell";

export default async function BrowserRunPage({
  params,
}: {
  readonly params: Promise<{ readonly groupId: string }>;
}) {
  const { groupId } = await params;
  return (
    <ManagerShell active="tasks">
      <BrowserRunDetail groupId={groupId} />
    </ManagerShell>
  );
}
