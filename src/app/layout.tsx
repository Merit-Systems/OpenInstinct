import type { Metadata } from "next";
import { headers } from "next/headers";
import { TooltipProvider } from "@/components/ui/tooltip";
import { accessScopeForUser } from "@/lib/access-scope";
import { applicationOrigin } from "@/lib/application-origin";
import { getAuthSession } from "@/auth/session";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(applicationOrigin()),
  title: "OpenInstinct",
  description:
    "A self-hosted personal agent with private credentials and Kernel-powered browser execution.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const session = await getAuthSession(await headers());
  const workspaceId = session?.user?.id
    ? accessScopeForUser(`better-auth:${session.user.id}`).workspaceId
    : undefined;

  return (
    <html lang="en">
      <body data-workspace-id={workspaceId}>
        <TooltipProvider>{children}</TooltipProvider>
      </body>
    </html>
  );
}
