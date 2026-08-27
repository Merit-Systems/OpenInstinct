import type { Metadata } from "next";
import type { ReactNode } from "react";
import { headers } from "next/headers";
import { TooltipProvider } from "@/components/ui/tooltip";
import { accessScopeForUser } from "@/lib/access-scope";
import { getAuthSession } from "@/lib/auth/session";
import { env } from "@/lib/env";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(env.BETTER_AUTH_URL),
  title: "OpenInstinct",
  description:
    "A self-hosted personal agent with private credentials and Kernel-powered browser execution.",
};

export default async function RootLayout({
  children,
}: {
  readonly children: ReactNode;
}) {
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
