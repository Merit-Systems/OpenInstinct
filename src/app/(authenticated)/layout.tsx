import Link from "next/link";
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
import { requireRequestScope } from "@/lib/request-scope";
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
  await requireRequestScope();

  return (
    <TRPCProvider>
      <SidebarProvider style={sidebarStyle}>
        <Sidebar>
          <SidebarHeader className="border-b border-sidebar-border p-4">
            <Link aria-label="Workspace" className="w-fit" href="/">
              <Logo className="size-7" />
            </Link>
          </SidebarHeader>
          <SidebarContent>
            <AuthenticatedNavigation />
          </SidebarContent>
          <SidebarFooter className="p-0">
            <AuthenticatedAccountControl />
          </SidebarFooter>
        </Sidebar>
        <SidebarInset className="h-svh overflow-y-auto">
          <AuthenticatedMobileHeader />
          {children}
        </SidebarInset>
      </SidebarProvider>
    </TRPCProvider>
  );
}
