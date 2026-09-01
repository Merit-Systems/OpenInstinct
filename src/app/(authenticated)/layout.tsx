import Link from "next/link";
import { redirect } from "next/navigation";
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
import { requireRequestScope, UnauthenticatedError } from "@/lib/request-scope";
import { isAdmin } from "@/lib/admin";
import { TRPCProvider } from "@/trpc/client";
import { AuthenticatedAccountControl } from "./_components/account-control";
import {
  AuthenticatedMobileHeader,
  AuthenticatedNavigation,
} from "./_components/authenticated-navigation";

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
            <AuthenticatedNavigation isAdmin={admin} />
          </SidebarContent>
          <SidebarFooter>
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
