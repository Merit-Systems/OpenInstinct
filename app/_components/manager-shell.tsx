import {
  BotIcon,
  BoxesIcon,
  LayoutDashboardIcon,
  MessageSquareIcon,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const navigation = [
  { href: "/", icon: LayoutDashboardIcon, id: "manager", label: "Manager" },
  { href: "/tasks", icon: BoxesIcon, id: "tasks", label: "Browser jobs" },
] as const;

export function ManagerShell({
  active,
  children,
}: {
  readonly active: (typeof navigation)[number]["id"];
  readonly children: ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="flex w-full items-center gap-4 px-4 py-3">
          <Link className="flex shrink-0 items-center gap-2" href="/">
            <span className="flex size-7 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <BotIcon className="size-3.5" />
            </span>
            <span className="type-product-title">Local Vault</span>
          </Link>

          <nav
            aria-label="Manager navigation"
            className="ml-auto flex items-center gap-1 sm:ml-4"
          >
            {navigation.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  aria-current={active === item.id ? "page" : undefined}
                  className={cn(
                    buttonVariants({
                      size: "sm",
                      variant: active === item.id ? "subtle" : "quiet",
                    }),
                    "hidden sm:inline-flex"
                  )}
                  href={item.href}
                  key={item.id}
                >
                  <Icon />
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <Link
            className={buttonVariants({ size: "sm", variant: "default" })}
            href="/chat"
          >
            <MessageSquareIcon />
            <span className="hidden sm:inline">Open chat</span>
            <span className="sm:hidden">Chat</span>
          </Link>
        </div>
        <nav
          aria-label="Manager navigation on small screens"
          className="flex gap-1 border-t border-border/40 px-3 py-1 sm:hidden"
        >
          {navigation.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                aria-current={active === item.id ? "page" : undefined}
                className={cn(
                  buttonVariants({
                    size: "sm",
                    variant: active === item.id ? "subtle" : "quiet",
                  }),
                  "flex-1"
                )}
                href={item.href}
                key={item.id}
              >
                <Icon />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </header>
      <div className="mx-auto flex w-full max-w-3xl flex-col px-4 py-10 sm:py-12">
        {children}
      </div>
    </div>
  );
}
