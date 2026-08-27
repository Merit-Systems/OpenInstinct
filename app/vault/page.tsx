import { ManagerShell } from "@/app/_components/manager-shell";
import { VaultManager } from "@/app/_components/manager/vault";
import { managerSetupRequestSchema } from "@/lib/manager";

export default async function Page({
  searchParams,
}: {
  readonly searchParams: Promise<
    Record<string, string | readonly string[] | undefined>
  >;
}) {
  const query = await searchParams;
  const requestedSetup = managerSetupRequestSchema.safeParse({
    identifierType: firstQueryValue(query.identifier_type),
    kind: firstQueryValue(query.kind),
    label: firstQueryValue(query.label),
    target: firstQueryValue(query.setup),
  });

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

function firstQueryValue(value: string | readonly string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
