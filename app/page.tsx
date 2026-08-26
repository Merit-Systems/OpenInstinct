import { ManagerShell } from "@/app/_components/manager-shell";
import { LocalVaultAssistantManager } from "@/app/_components/local-vault-assistant-manager";
import { getEnv } from "@/env";
import { redirect } from "next/navigation";

export default function Page() {
  if (getEnv().VERCEL) redirect("/chat");

  return (
    <ManagerShell active="manager">
      <LocalVaultAssistantManager />
    </ManagerShell>
  );
}
