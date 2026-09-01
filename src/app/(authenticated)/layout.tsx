import Link from "next/link";
import { Logo } from "@/components/ui/logo";
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
} from "@/components/ui/sidebar";
import { requireRequestScope } from "@/lib/request-scope";
import { TRPCProvider } from "@/trpc/client";
import { AuthenticatedAccountControl } from "./_components/account-control";
import {
  AuthenticatedMobileHeader,
  AuthenticatedNavigation,
} from "./_components/authenticated-navigation";

export default async function AuthenticatedLayout({
  children,
}: LayoutProps<"/">) {
  await requireRequestScope();

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
            <AuthenticatedNavigation />
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
