import { defineTool } from "eve/tools";
import {
  createManagerSetupUrl,
  managerSetupRequestSchema,
} from "@/lib/manager";
import { env } from "@/lib/env";

export default defineTool({
  description:
    "Create a safe link for adding one supported item to the self-hosted vault. Supported kinds are login (email, phone, or username with a password or one-time-code method), payment (card details), address (structured delivery or billing address), and contact (name, email, and phone). A login setup requires a descriptive label and identifierType; the user enters the actual identifier and secret on the vault page. Other kinds accept only kind and an optional label. Never put an email address, phone number, username, or secret in this setup request. Use ordinary non-secret contact details directly when the user supplied them in chat.",
  inputSchema: managerSetupRequestSchema,
  execute(request) {
    return {
      message:
        "Open this page in your Local Vault Assistant deployment and complete the form. Do not send the secret in chat.",
      url: createManagerSetupUrl(env.BETTER_AUTH_URL, request),
    };
  },
});
