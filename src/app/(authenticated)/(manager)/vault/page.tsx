import { VaultManager } from "./_components/vault-manager";
import { requireRequestScope } from "@/lib/request-scope";
import {
  managerSnapshotSchema,
  parseManagerSetupSearchParams,
} from "@/lib/manager";
import { readManagerSnapshot } from "@/lib/manager/server/store";
import { z } from "zod";

export default async function Page({ searchParams }: PageProps<"/vault">) {
  const query = await searchParams;
  const requestedSetup = parseManagerSetupSearchParams(query);
  const scope = await requireRequestScope();
  const initialSnapshot = managerSnapshotSchema.parse(
    await readManagerSnapshot(scope)
  );

  return (
    <VaultManager
      initialChromeImport={firstQueryValue(query.import) === "chrome"}
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
  const scalar = z.string().safeParse(value);
  return scalar.success ? scalar.data : value?.[0];
}
