import type { Metadata } from "next";
import type { ReactNode } from "react";
import { headers } from "next/headers";
import { TooltipProvider } from "@/components/ui/tooltip";
import { accessScopeForUser, localAccessScope } from "@/lib/access-scope";
import { getDeploymentMode } from "@/lib/deployment-mode";
import { getHostedAuthSession } from "@/lib/server/auth-session";
import "./globals.css";

export const metadata: Metadata = {
  title: "Local Vault Assistant",
  description:
    "A local-first personal agent with private connections, credentials, and Kernel-powered browser execution.",
};

export default async function RootLayout({
  children,
}: {
  readonly children: ReactNode;
}) {
  const mode = getDeploymentMode();
  const session =
    mode === "hosted" ? await getHostedAuthSession(await headers()) : null;
  const workspaceId =
    mode === "local"
      ? localAccessScope.workspaceId
      : session?.user?.id
        ? accessScopeForUser(`better-auth:${session.user.id}`).workspaceId
        : undefined;

  return (
    <html lang="en">
      <body
        data-auth-required={mode === "hosted" ? "true" : "false"}
        data-workspace-id={workspaceId}
      >
        <TooltipProvider>{children}</TooltipProvider>
      </body>
    </html>
  );
}
