import { defineTool } from "eve/tools";
import {
  createManagerSetupUrl,
  managerSetupRequestSchema,
} from "../../lib/manager.js";
import { getEnv } from "../../lib/runtime-env.js";

export default defineTool({
  description:
    "Create a safe link to the self-hosted vault when the user needs to add a credential. Call this instead of asking for a secret in chat, then give the returned link to the user.",
  inputSchema: managerSetupRequestSchema,
  execute(request) {
    const baseUrl = getEnv().BETTER_AUTH_URL;
    if (!baseUrl) throw new Error("BETTER_AUTH_URL is required.");

    return {
      message:
        "Open this page in your Local Vault Assistant deployment and complete the form. Do not send the secret in chat.",
      url: createManagerSetupUrl(baseUrl, request),
    };
  },
});
