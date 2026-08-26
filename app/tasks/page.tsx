import { BrowserBatchRunner } from "@/app/_components/browser-batch-runner";
import { ManagerShell } from "@/app/_components/manager-shell";

export default function TasksPage() {
  return (
    <ManagerShell active="tasks">
      <BrowserBatchRunner />
    </ManagerShell>
  );
}
