import { defineTool } from "eve/tools";
import { getEnv } from "../../env.js";
import {
  createManagerSetupUrl,
  managerSetupRequestSchema,
} from "../../lib/manager.js";

export default defineTool({
  description:
    "Create a safe link to the device-local manager when the user needs to add a connection or vault credential. Call this instead of asking for a secret in chat, then give the returned link to the user.",
  inputSchema: managerSetupRequestSchema,
  execute(request) {
    const url = createManagerSetupUrl(
      getEnv().LOCAL_VAULT_ASSISTANT_MANAGER_URL ??
        "https://local-vault-assistant.localhost",
      request
    );

    return {
      message:
        "Open this page on the device running Local Vault Assistant and complete the requested form. Do not send the secret in chat.",
      url,
    };
  },
});
