import { defineDynamic, defineTool } from "eve/tools";
import { patchUserProfile } from "@/db/services/user-profile";
import { userProfilePatchSchema, userProfileSchema } from "@/lib/user-profile";
import { resolveModeValue } from "../lib/mode";
import { resolvePersonalInfoAccessScope } from "../lib/profile-memory";

const updateUserProfile = defineTool({
  description:
    "Update model-readable Personal Info after the user explicitly states or corrects reusable form information. Pass null to remove a field. Never store credentials, payment details, tokens, or one-time codes.",
  inputSchema: userProfilePatchSchema,
  outputSchema: userProfileSchema,
  async execute(input, context) {
    const scope = resolvePersonalInfoAccessScope(context);
    if (!scope) throw new Error("An authenticated user is required.");
    return patchUserProfile(scope, input);
  },
});

export default defineDynamic({
  events: {
    "turn.started": (_event, context) =>
      resolveModeValue(context, { interactive: updateUserProfile }),
  },
});
