import { defineTool } from "eve/tools";
import {
  createManagerSetupUrl,
  managerSetupRequestSchema,
} from "../../lib/manager.js";
import { getEnv } from "../../lib/runtime-env.js";

export default defineTool({
  description:
    "Create a safe link for adding one supported item to the self-hosted vault. Supported kinds are login (email, phone, or username with a password or one-time-code method), payment (card details), address (structured delivery or billing address), and contact (name, email, and phone). The only safe prefill inputs are kind, label, and account; never invent or request other vault fields. Use ordinary non-secret contact details directly when the user supplied them in chat.",
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
