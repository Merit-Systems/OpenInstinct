import { ManagerShell } from "@/app/_components/manager-shell";
import { VaultManager } from "@/app/_components/manager/vault";
import { parseManagerSetupSearchParams } from "@/lib/manager";

export default async function Page({
  searchParams,
}: {
  readonly searchParams: Promise<
    Record<string, string | readonly string[] | undefined>
  >;
}) {
  const query = await searchParams;
  const requestedSetup = parseManagerSetupSearchParams(query);

  return (
    <ManagerShell active="vault">
      <VaultManager
        initialSetup={
          requestedSetup.success && requestedSetup.data.target === "vault"
            ? requestedSetup.data
            : undefined
        }
      />
    </ManagerShell>
  );
}
