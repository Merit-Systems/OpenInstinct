import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getLocalDataDirectory } from "../../data-directory";
import { getEnv } from "../../runtime-env";
import type { AppStore } from "./store";

let storePromise: Promise<AppStore> | undefined;

export function getAppStore() {
  storePromise ??= createAppStore();
  return storePromise;
}

async function createAppStore() {
  const databaseUrl = getEnv().DATABASE_URL;
  let store: AppStore;

  if (
    databaseUrl?.startsWith("postgres://") ||
    databaseUrl?.startsWith("postgresql://")
  ) {
    const { createNeonStore } = await import("./neon-store");
    store = createNeonStore(databaseUrl);
  } else {
    const { createSqliteStore } = await import("./sqlite-store");
    store = createSqliteStore(
      databaseUrl?.startsWith("file:")
        ? fileURLToPath(databaseUrl)
        : join(getLocalDataDirectory(), "manager.sqlite")
    );
  }

  await store.initialize();
  return store;
}
