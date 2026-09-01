"use client";

import {
  ArrowLeftIcon,
  ChevronRightIcon,
  Globe2Icon,
  SearchIcon,
  Trash2Icon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { VaultItem } from "@/lib/vault";
import { api } from "@/trpc/client";

const VAULT_DIALOG_PAGE_SIZE = 50;
const dialogContentClass =
  "top-auto bottom-0 max-h-[min(32rem,calc(100dvh-0.5rem))] translate-y-0 overscroll-contain rounded-b-none pb-[max(1rem,env(safe-area-inset-bottom))] sm:top-1/2 sm:bottom-auto sm:max-h-[min(32rem,calc(100dvh-2rem))] sm:max-w-2xl sm:-translate-y-1/2 sm:rounded-xl sm:pb-4 [&_[data-slot=dialog-close]]:top-3 [&_[data-slot=dialog-close]]:right-3 [&_[data-slot=dialog-close]]:size-10 sm:[&_[data-slot=dialog-close]]:top-2 sm:[&_[data-slot=dialog-close]]:right-2 sm:[&_[data-slot=dialog-close]]:size-7 [&_[data-slot=input]]:h-12 sm:[&_[data-slot=input]]:h-8 [&_[data-slot=select-trigger]]:h-12 sm:[&_[data-slot=select-trigger]]:h-8 [&_button[type=submit]]:h-12 [&_button[type=submit]]:w-full sm:[&_button[type=submit]]:h-8 sm:[&_button[type=submit]]:w-auto";

type VaultSectionView = "add" | "import" | "list";

export function useVaultSection(initialView: VaultSectionView) {
  const [open, setOpen] = useState(initialView !== "list");
  const [view, setView] = useState(initialView);

  const onOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) setView("list");
  };

  return { onOpenChange, open, setView, view };
}

export function VaultSection({
  children,
  onOpenChange,
  open,
  title,
}: {
  readonly children: ReactNode;
  readonly onOpenChange: (open: boolean) => void;
  readonly open: boolean;
  readonly title: string;
}) {
  return (
    <section aria-label={title}>
      <Dialog onOpenChange={onOpenChange} open={open}>
        {children}
      </Dialog>
    </section>
  );
}

export function VaultSectionTrigger({
  items,
  title,
}: {
  readonly items: readonly VaultItem[];
  readonly title: string;
}) {
  return (
    <DialogTrigger
      render={
        <Button
          className="h-14 w-full justify-between px-4 text-left"
          type="button"
          variant="outline"
        />
      }
    >
      <span className="min-w-0">
        <span className="block type-label">{title}</span>
        <span className="type-supporting-body block font-normal text-muted-foreground">
          {items.length > 0
            ? `${items.length.toLocaleString()} saved`
            : `No saved ${title.toLocaleLowerCase()}`}
        </span>
      </span>
      <ChevronRightIcon />
    </DialogTrigger>
  );
}

export function VaultSectionContent({
  children,
  view,
}: {
  readonly children: ReactNode;
  readonly view: VaultSectionView;
}) {
  return (
    <DialogContent
      animated={false}
      className={
        view === "list"
          ? `${dialogContentClass} grid-rows-[auto_auto_minmax(0,1fr)_auto] overflow-hidden`
          : `${dialogContentClass} no-scrollbar overflow-y-auto`
      }
    >
      {children}
    </DialogContent>
  );
}

export function VaultSectionBackButton({
  onClick,
  title,
}: {
  readonly onClick: () => void;
  readonly title: string;
}) {
  return (
    <Button
      className="w-fit transition-none active:translate-y-0"
      onClick={onClick}
      size="sm"
      type="button"
      variant="plain"
    >
      <ArrowLeftIcon />
      {title}
    </Button>
  );
}

export function VaultItemBrowser({
  items,
  searchId,
  title,
}: {
  readonly items: readonly VaultItem[];
  readonly searchId: string;
  readonly title: string;
}) {
  const [query, setQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(VAULT_DIALOG_PAGE_SIZE);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredItems = normalizedQuery
    ? items.filter((item) =>
        `${item.label}\n${item.account}`
          .toLocaleLowerCase()
          .includes(normalizedQuery)
      )
    : items;
  const visibleItems = filteredItems.slice(0, visibleCount);

  return (
    <>
      {items.length > 0 ? (
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Label className="sr-only" htmlFor={searchId}>
            Search {title.toLocaleLowerCase()}
          </Label>
          <Input
            className="pl-8"
            id={searchId}
            onChange={(event) => {
              setQuery(event.target.value);
              setVisibleCount(VAULT_DIALOG_PAGE_SIZE);
            }}
            placeholder="Search by name or account"
            type="search"
            value={query}
          />
        </div>
      ) : (
        <div />
      )}

      <section
        aria-label={`${title} list`}
        className="-mx-4 no-scrollbar min-h-0 overflow-y-auto px-4"
        onScroll={(event) => {
          const list = event.currentTarget;
          const nearEnd =
            list.scrollHeight - list.scrollTop - list.clientHeight < 96;
          if (nearEnd && visibleCount < filteredItems.length) {
            setVisibleCount((count) =>
              Math.min(count + VAULT_DIALOG_PAGE_SIZE, filteredItems.length)
            );
          }
        }}
      >
        {visibleItems.length > 0 ? (
          <VaultItemList items={visibleItems} />
        ) : query.trim() ? (
          <p className="type-supporting-body py-10 text-center text-muted-foreground">
            No matches for “{query.trim()}”
          </p>
        ) : (
          <p className="type-supporting-body py-10 text-center text-muted-foreground">
            No saved {title.toLocaleLowerCase()} yet.
          </p>
        )}
      </section>
    </>
  );
}

export function VaultItemList({
  items,
}: {
  readonly items: readonly VaultItem[];
}) {
  return (
    <div className="divide-y divide-border/50">
      {items.map((item) => (
        <VaultItemRow item={item} key={item.id} />
      ))}
    </div>
  );
}

function VaultItemRow({ item }: { readonly item: VaultItem }) {
  const router = useRouter();
  const remove = api.vault.remove.useMutation({
    onSuccess: () => {
      router.refresh();
    },
  });

  return (
    <div className="flex min-w-0 items-center gap-3 py-3">
      <VaultItemIcon item={item} />
      <div className="min-w-0 flex-1">
        <p className="truncate type-label">{item.label}</p>
        {item.account ? (
          <p className="type-supporting-body truncate text-muted-foreground">
            {item.account}
          </p>
        ) : null}
      </div>
      <Button
        aria-label={`Remove ${item.label}`}
        disabled={remove.isPending}
        onClick={() => {
          remove.mutate({ id: item.id });
        }}
        size="icon-sm"
        type="button"
        variant="quiet"
      >
        <Trash2Icon />
      </Button>
    </div>
  );
}

function VaultItemIcon({ item }: { readonly item: VaultItem }) {
  const faviconUrl = loginFaviconUrl(item);
  return (
    <span className="relative flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted text-muted-foreground">
      <Globe2Icon className="size-4" />
      {faviconUrl ? (
        // Imported domains cannot be declared in Next Image configuration.
        // oxlint-disable-next-line nextjs/no-img-element -- user-imported favicon URL
        <img
          alt=""
          className="absolute inset-0 size-full bg-background object-contain p-1"
          onError={(event) => {
            event.currentTarget.remove();
          }}
          referrerPolicy="no-referrer"
          src={faviconUrl}
        />
      ) : null}
    </span>
  );
}

function loginFaviconUrl(item: VaultItem): string | undefined {
  if (item.kind !== "login") return undefined;
  const hostname = item.account.split(" · ", 1)[0]?.trim();
  if (!hostname || !hostname.includes(".") || hostname.includes(" ")) {
    return undefined;
  }
  try {
    return new URL("/favicon.ico", `https://${hostname}`).toString();
  } catch {
    return undefined;
  }
}
