import { ManagerShell } from "@/app/_components/manager-shell";
import { WorkspaceManager } from "@/app/_components/manager/workspace";

export default async function Page({
  searchParams,
}: {
  readonly searchParams: Promise<{ google?: string | string[] }>;
}) {
  const google = (await searchParams).google;
  const googleNotice = google === "unavailable" ? "unavailable" : undefined;

  return (
    <ManagerShell active="workspace">
      <WorkspaceManager googleNotice={googleNotice} />
    </ManagerShell>
  );
}
