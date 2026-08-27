"use client";

import {
  HistoryIcon,
  HouseIcon,
  KeyRoundIcon,
  MessageSquareIcon,
  PanelsTopLeftIcon,
} from "lucide-react";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { buttonVariants } from "@/components/ui/button";
import { Logo } from "@/components/ui/logo";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { useManager } from "./manager/use-manager";
import { AccountControl } from "./account-control";

const managerNavigation = [
  { href: "/", icon: PanelsTopLeftIcon, id: "workspace", label: "Workspace" },
  { href: "/vault", icon: KeyRoundIcon, id: "vault", label: "Vault" },
  { href: "/chat", icon: MessageSquareIcon, id: "chat", label: "Chat" },
  { href: "/chats", icon: HistoryIcon, id: "chats", label: "All chats" },
] as const;

const managerSidebarStyle: CSSProperties & { "--sidebar-width": string } = {
  "--sidebar-width": "12rem",
};

export function ManagerShell({
  active,
  children,
}: {
  readonly active: "chat" | "chats" | "tasks" | "vault" | "workspace";
  readonly children: ReactNode;
}) {
  if (active === "tasks") {
    return <TaskShell>{children}</TaskShell>;
  }

  return <ManagerAppShell active={active}>{children}</ManagerAppShell>;
}

function ManagerAppShell({
  active,
  children,
}: {
  readonly active: "chat" | "chats" | "vault" | "workspace";
  readonly children: ReactNode;
}) {
  const { snapshot } = useManager();
  const browserReady = Boolean(snapshot?.browser.available);

  const activeItem = managerNavigation.find((item) => item.id === active);

  return (
    <SidebarProvider style={managerSidebarStyle}>
      <Sidebar>
        <SidebarHeader className="border-b border-sidebar-border px-4 py-4">
          <Link aria-label="Workspace" className="w-fit" href="/">
            <Logo className="size-7" />
          </Link>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarMenu>
              {managerNavigation.map((item) => {
                const Icon = item.icon;
                const isActive = active === item.id;
                const isDisabled = item.id === "chat" && !browserReady;
                return (
                  <SidebarMenuItem key={item.id}>
                    <SidebarMenuButton
                      aria-disabled={isDisabled}
                      disabled={isDisabled}
                      isActive={isActive}
                      render={
                        isDisabled ? undefined : <Link href={item.href} />
                      }
                    >
                      <Icon />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter className="p-0">
          <AccountControl />
        </SidebarFooter>
      </Sidebar>
      <SidebarInset className="h-svh overflow-hidden">
        <header className="flex h-12 items-center gap-2 border-b border-border/50 px-4 md:hidden">
          <SidebarTrigger />
          <span className="type-label">{activeItem?.label}</span>
        </header>
        {active === "chat" ? (
          children
        ) : (
          <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
            {children}
          </div>
        )}
      </SidebarInset>
    </SidebarProvider>
  );
}

function TaskShell({ children }: { readonly children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="flex w-full items-center gap-4 px-4 py-3">
          <Link aria-label="Workspace" href="/">
            <Logo className="size-7" />
          </Link>
          <nav
            aria-label="Task navigation"
            className="ml-auto flex items-center gap-1"
          >
            <Link
              className={buttonVariants({ size: "sm", variant: "quiet" })}
              href="/"
            >
              <HouseIcon />
              Home
            </Link>
            <Link
              className={buttonVariants({ size: "sm", variant: "default" })}
              href="/chat"
            >
              <MessageSquareIcon />
              Chat
            </Link>
          </nav>
        </div>
      </header>
      <div className="mx-auto flex w-full max-w-3xl flex-col px-4 py-6 sm:py-8">
        {children}
      </div>
    </div>
  );
}
