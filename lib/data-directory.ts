import { homedir } from "node:os";
import { join } from "node:path";
import { getEnv } from "../env";

export function getLocalDataDirectory() {
  return (
    getEnv().LOCAL_VAULT_ASSISTANT_DATA_DIR ??
    join(homedir(), ".local-vault-assistant")
  );
}
