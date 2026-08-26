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
    <div className="min-h-dvh bg-background text-foreground lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
      <aside className="border-b bg-card lg:sticky lg:top-0 lg:h-dvh lg:border-r lg:border-b-0">
        <div className="flex h-full flex-col gap-5 px-4 py-4 lg:px-3 lg:py-5">
          <Link className="flex items-center gap-2.5 px-2" href="/">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <BotIcon className="size-4" />
            </span>
            <span className="type-card-title">Local Vault Assistant</span>
          </Link>

          <nav
            aria-label="Manager navigation"
            className="flex gap-1 lg:flex-col"
          >
            {navigation.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  aria-current={active === item.id ? "page" : undefined}
                  className={cn(
                    buttonVariants({
                      variant: active === item.id ? "secondary" : "ghost",
                    }),
                    "justify-start"
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

          <div className="ml-auto lg:mt-auto lg:ml-0">
            <Link
              className={cn(buttonVariants({ variant: "default" }), "w-full")}
              href="/chat"
            >
              <MessageSquareIcon />
              Open chat
            </Link>
          </div>
        </div>
      </aside>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
