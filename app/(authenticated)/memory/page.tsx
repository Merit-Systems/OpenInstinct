import { notFound } from "next/navigation";
import { knowledgeMemoryModeForWorkspace } from "@shared/memory/config";
import { requireRequestScope } from "@web/auth/request-scope";
import { MemoryBrowser } from "./_components/memory-browser";

export default async function Page() {
  const scope = await requireRequestScope();
  const mode = knowledgeMemoryModeForWorkspace(scope.workspaceId);
  if (mode === "off") notFound();
  return <MemoryBrowser mode={mode} />;
}
