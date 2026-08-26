import type { Metadata } from "next";
import type { ReactNode } from "react";
import { auth } from "@/auth";
import { AuthProvider } from "@/app/_components/auth-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { accessScopeForUser, localAccessScope } from "@/lib/access-scope";
import { getDeploymentMode } from "@/lib/deployment-mode";
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
  const session = mode === "hosted" ? await auth() : null;
  const workspaceId =
    mode === "local"
      ? localAccessScope.workspaceId
      : session?.user?.id
        ? accessScopeForUser(session.user.id).workspaceId
        : undefined;

  return (
    <html lang="en">
      <body data-workspace-id={workspaceId}>
        <AuthProvider session={session}>
          <TooltipProvider>{children}</TooltipProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
