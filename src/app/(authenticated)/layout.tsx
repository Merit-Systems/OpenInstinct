import Link from "next/link";
import { redirect } from "next/navigation";
import type { CSSProperties } from "react";
import { Logo } from "@/components/ui/logo";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
} from "@/components/ui/sidebar";
import { requireRequestScope, UnauthenticatedError } from "@/lib/request-scope";
import { isAdmin } from "@/lib/admin";
import { TRPCProvider } from "@/trpc/client";
import { AuthenticatedAccountControl } from "./_components/account-control";
import {
  AuthenticatedMobileHeader,
  AuthenticatedNavigation,
} from "./_components/authenticated-navigation";

const sidebarStyle: CSSProperties & { "--sidebar-width": string } = {
  "--sidebar-width": "12rem",
};

export default async function AuthenticatedLayout({
  children,
}: LayoutProps<"/">) {
  try {
    await requireRequestScope();
  } catch (error) {
    if (error instanceof UnauthenticatedError) redirect("/sign-in");
    throw error;
  }
  const admin = await isAdmin();

  return (
    <TRPCProvider>
      <SidebarProvider style={sidebarStyle}>
        <Sidebar>
          <SidebarHeader className="border-b border-sidebar-border px-4 py-4">
            <Link aria-label="Workspace" className="w-fit" href="/">
              <Logo className="size-7" />
            </Link>
          </SidebarHeader>
          <SidebarContent>
            <AuthenticatedNavigation isAdmin={admin} />
          </SidebarContent>
          <SidebarFooter className="p-0">
            <AuthenticatedAccountControl />
          </SidebarFooter>
        </Sidebar>
        <SidebarInset className="h-svh overflow-y-auto">
          <AuthenticatedMobileHeader isAdmin={admin} />
          {children}
        </SidebarInset>
      </SidebarProvider>
    </TRPCProvider>
  );
}
