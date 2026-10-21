import { env } from "@shared/environment";

export function knowledgeMemoryModeForWorkspace(workspaceId: string) {
  const allowed = env.KNOWLEDGE_MEMORY_WORKSPACES?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (allowed && !allowed.includes(workspaceId)) return "off";
  return env.KNOWLEDGE_MEMORY_MODE;
}
