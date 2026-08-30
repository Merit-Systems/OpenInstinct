import type { ReactNode } from "react";
import Link from "next/link";

const links = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/workspaces", label: "Workspaces" },
  { href: "/admin/audit", label: "Audit log" },
  { href: "/admin/webhooks", label: "Webhooks" },
  { href: "/admin/usage", label: "Usage" },
] as const;

export function AdminShell({
  children,
  title,
  description,
}: {
  readonly children: ReactNode;
  readonly title: string;
  readonly description: string;
}) {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-8 px-4 py-6 sm:px-6 sm:py-8">
      <header className="space-y-4 border-b border-border pb-5">
        <div>
          <h1 className="type-page-title">{title}</h1>
          <p className="type-supporting-body mt-1 text-muted-foreground">
            {description}
          </p>
        </div>
        <nav
          aria-label="Admin navigation"
          className="flex flex-wrap gap-x-4 gap-y-2 type-label"
        >
          {links.map((link) => (
            <Link
              className="text-muted-foreground hover:text-foreground"
              href={link.href}
              key={link.href}
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </header>
      {children}
    </div>
  );
}
