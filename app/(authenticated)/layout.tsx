import Link from "next/link";
import { Logo } from "@web/components/ui/logo";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@web/components/ui/sidebar";
import { requireRequestScope } from "@web/auth/request-scope";
import { knowledgeMemoryModeForWorkspace } from "@shared/memory/config";
import { TRPCProvider } from "@web/trpc/client";
import { AuthenticatedAccountControl } from "./_components/account-control";
import {
  AuthenticatedMobileHeader,
  AuthenticatedNavigation,
} from "./_components/authenticated-navigation";

export default async function AuthenticatedLayout({
  children,
}: LayoutProps<"/">) {
  const scope = await requireRequestScope();
  const memoryVisible =
    knowledgeMemoryModeForWorkspace(scope.workspaceId) !== "off";

  return (
    <TRPCProvider>
      <SidebarProvider>
        <Sidebar>
          <SidebarHeader>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton render={<Link href="/" />}>
                  <Logo />
                  <span>OpenInstinct</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarHeader>
          <SidebarContent>
            <AuthenticatedNavigation memoryVisible={memoryVisible} />
          </SidebarContent>
          <SidebarFooter>
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
