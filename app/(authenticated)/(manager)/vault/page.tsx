import { VaultManager } from "./_components/vault-manager";
import { requireRequestScope } from "@/lib/request-scope";
import {
  managerSetupRequestSchema,
  managerSnapshotSchema,
} from "@/lib/manager";
import { readManagerSnapshot } from "@/lib/manager/server/store";

export default async function Page({ searchParams }: PageProps<"/vault">) {
  const query = await searchParams;
  const requestedSetup = managerSetupRequestSchema.safeParse({
    account: firstQueryValue(query.account),
    kind: firstQueryValue(query.kind),
    label: firstQueryValue(query.label),
    target: firstQueryValue(query.setup),
  });
  const scope = await requireRequestScope();
  const initialSnapshot = managerSnapshotSchema.parse(
    await readManagerSnapshot(scope)
  );

  return (
    <VaultManager
      initialSetup={
        requestedSetup.success && requestedSetup.data.target === "vault"
          ? requestedSetup.data
          : undefined
      }
      initialSnapshot={initialSnapshot}
    />
  );
}

function firstQueryValue(value: string | readonly string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
