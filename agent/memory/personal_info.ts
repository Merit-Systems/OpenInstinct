import { defineMemory } from "eve/memory";
import { personalInfoMemoryProvider } from "../lib/personal-info-memory";
import { resolvePersonalInfoMemoryScope } from "../lib/profile-memory";

export default defineMemory({
  description:
    "Provide the current user's structured, model-readable Personal Info profile.",
  namespace: "openinstinct-personal-info-v1",
  provider: personalInfoMemoryProvider,
  scope: resolvePersonalInfoMemoryScope,
});
