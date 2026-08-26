import { HostedManagerOnboarding } from "@/app/_components/hosted-manager-onboarding";
import { ManagerShell } from "@/app/_components/manager-shell";
import { LocalVaultAssistantManager } from "@/app/_components/local-vault-assistant-manager";
import { getEnv } from "@/lib/runtime-env";
import {
  DEFAULT_LOCAL_MANAGER_URL,
  managerSetupRequestSchema,
} from "@/lib/manager";

export default async function Page({
  searchParams,
}: {
  readonly searchParams: Promise<
    Record<string, string | readonly string[] | undefined>
  >;
}) {
  const env = getEnv();
  if (env.VERCEL || env.VERCEL_ENV) {
    return (
      <ManagerShell active="manager">
        <HostedManagerOnboarding
          managerUrl={
            env.LOCAL_VAULT_ASSISTANT_MANAGER_URL ?? DEFAULT_LOCAL_MANAGER_URL
          }
        />
      </ManagerShell>
    );
  }

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
