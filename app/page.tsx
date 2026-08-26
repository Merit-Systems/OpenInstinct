import { ManagerShell } from "@/app/_components/manager-shell";
import { LocalVaultAssistantManager } from "@/app/_components/local-vault-assistant-manager";
import { getEnv } from "@/env";
import { managerSetupRequestSchema } from "@/lib/manager";
import { redirect } from "next/navigation";

export default async function Page({
  searchParams,
}: {
  readonly searchParams: Promise<
    Record<string, string | readonly string[] | undefined>
  >;
}) {
  if (getEnv().VERCEL) redirect("/chat");

  const query = await searchParams;
  const requestedSetup = managerSetupRequestSchema.safeParse({
    account: firstQueryValue(query.account),
    endpoint: firstQueryValue(query.endpoint),
    kind: firstQueryValue(query.kind),
    label: firstQueryValue(query.label),
    provider: firstQueryValue(query.provider),
    target: firstQueryValue(query.setup),
  });

  return (
    <ManagerShell active="manager">
      <LocalVaultAssistantManager
        initialSetup={requestedSetup.success ? requestedSetup.data : undefined}
      />
    </ManagerShell>
  );
}

function firstQueryValue(value: string | readonly string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
