import { ManagerShell } from "@/app/_components/manager-shell";
import { WorkspaceManager } from "@/app/_components/manager/workspace";

export default function Page() {
  return (
    <ManagerShell active="workspace">
      <WorkspaceManager />
    </ManagerShell>
  );
}
