import { defineTool } from "eve/tools";
import { z } from "zod";
import { applicationOrigin } from "@/lib/application-origin";

export default defineTool({
  description:
    "Create a direct self-hosted link for bulk-importing login credentials from a Chrome or Google Password Manager CSV into the encrypted vault. Use this when the user wants to import or migrate multiple browser passwords. Never ask them to send the CSV or any password in chat.",
  inputSchema: z.object({}),
  execute() {
    return {
      message:
        "Open this page in your Local Vault Assistant deployment. It explains how to export from Chrome and opens the secure importer directly.",
      url: new URL("/vault?import=chrome", applicationOrigin()).toString(),
    };
  },
});
