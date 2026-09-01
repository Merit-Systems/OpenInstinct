"use client";

import {
  HistoryIcon,
  KeyRoundIcon,
  ListTodoIcon,
  MessageSquareIcon,
  PanelsTopLeftIcon,
  ShieldCheckIcon,
  UserRoundIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
} from "@/components/ui/sidebar";

const navigation = [
  { href: "/", icon: PanelsTopLeftIcon, id: "workspace", label: "Workspace" },
  { href: "/vault", icon: KeyRoundIcon, id: "vault", label: "Vault" },
  {
    href: "/personal-info",
    icon: UserRoundIcon,
    id: "personal-info",
    label: "Personal info",
  },
  { href: "/chat", icon: MessageSquareIcon, id: "chat", label: "Chat" },
  {
    href: "/chat/history",
    icon: HistoryIcon,
    id: "history",
    label: "All chats",
  },
  { href: "/tasks", icon: ListTodoIcon, id: "tasks", label: "Tasks" },
] as const;

export function AuthenticatedNavigation({
  isAdmin,
}: {
  readonly isAdmin: boolean;
}) {
  const active = activeRoute(usePathname());

  return (
    <>
      <SidebarGroup>
        <SidebarGroupContent>
          <nav aria-label="Primary">
            <SidebarMenu>
              {navigation.map((item) => {
                const Icon = item.icon;
                return (
                  <SidebarMenuItem key={item.id}>
                    <SidebarMenuButton
                      isActive={active === item.id}
                      render={<Link href={item.href} />}
                    >
                      <Icon />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </nav>
        </SidebarGroupContent>
      </SidebarGroup>
      {isAdmin ? (
        <SidebarGroup>
          <SidebarGroupContent>
            <nav aria-label="Admin">
              <p className="type-micro px-2 pb-2 text-muted-foreground">
                Admin
              </p>
              <SidebarMenu>
                {adminNavigation.map((item) => {
                  const Icon = item.icon;
                  return (
                    <SidebarMenuItem key={item.id}>
                      <SidebarMenuButton
                        isActive={active === item.id}
                        render={<Link href={item.href} />}
                      >
                        <Icon />
                        <span>{item.label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </nav>
          </SidebarGroupContent>
        </SidebarGroup>
      ) : null}
    </>
  );
}

export function AuthenticatedMobileHeader({
  isAdmin,
}: {
  readonly isAdmin: boolean;
}) {
  const active = activeRoute(usePathname());
  const label = [...navigation, ...(isAdmin ? adminNavigation : [])].find(
    (item) => item.id === active
  )?.label;

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border/50 px-4 md:hidden">
      <SidebarTrigger />
      <span className="type-label">{label}</span>
    </header>
  );
}

function activeRoute(pathname: string) {
  if (pathname === "/") return "workspace";
  if (pathname.startsWith("/vault")) return "vault";
  if (pathname.startsWith("/personal-info")) return "personal-info";
  if (pathname.startsWith("/chat/history")) return "history";
  if (pathname.startsWith("/chat")) return "chat";
  if (pathname.startsWith("/tasks") || pathname.startsWith("/runs")) {
    return "tasks";
  }
  if (pathname.startsWith("/admin/workspaces")) return "admin-workspaces";
  if (pathname.startsWith("/admin/audit")) return "admin-audit";
  if (pathname.startsWith("/admin/webhooks")) return "admin-webhooks";
  if (pathname.startsWith("/admin/usage")) return "admin-usage";
  if (pathname.startsWith("/admin")) return "admin";
  return undefined;
}

const adminNavigation = [
  { href: "/admin", icon: ShieldCheckIcon, id: "admin", label: "Admin" },
  {
    href: "/admin/workspaces",
    icon: PanelsTopLeftIcon,
    id: "admin-workspaces",
    label: "Workspaces",
  },
  {
    href: "/admin/audit",
    icon: HistoryIcon,
    id: "admin-audit",
    label: "Audit log",
  },
  {
    href: "/admin/webhooks",
    icon: MessageSquareIcon,
    id: "admin-webhooks",
    label: "Webhooks",
  },
  {
    href: "/admin/usage",
    icon: ListTodoIcon,
    id: "admin-usage",
    label: "Usage",
  },
] as const;
