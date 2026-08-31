"use client";

import {
  ArrowLeftIcon,
  ChevronRightIcon,
  Globe2Icon,
  KeyRoundIcon,
  PlusIcon,
  SearchIcon,
  Trash2Icon,
} from "lucide-react";
import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type {
  ManagerMutation,
  ManagerSetupRequest,
  ManagerSnapshot,
  VaultCreateItemKind,
} from "@/modules/manager";
import { api } from "@/trpc/client";
import { AddressVaultForm } from "./address-vault-form";
import { ChromePasswordImportPanel } from "./chrome-password-import";
import { ContactVaultForm } from "./contact-vault-form";
import { LoginVaultForm } from "./login-vault-form";
import { PaymentCardForm } from "./payment-card-form";

const categories = [
  {
    addLabel: "Add login",
    kind: "login",
    title: "Logins",
  },
  {
    addLabel: "Add card",
    kind: "payment",
    title: "Cards",
  },
  {
    addLabel: "Add address",
    kind: "address",
    title: "Addresses",
  },
  {
    addLabel: "Add contact",
    kind: "contact",
    title: "Contact info",
  },
] as const;

const VAULT_DIALOG_PAGE_SIZE = 50;
const dialogContentClass =
  "top-auto bottom-0 max-h-[min(32rem,calc(100dvh-0.5rem))] translate-y-0 overscroll-contain rounded-b-none pb-[max(1rem,env(safe-area-inset-bottom))] sm:top-1/2 sm:bottom-auto sm:max-h-[min(32rem,calc(100dvh-2rem))] sm:max-w-2xl sm:-translate-y-1/2 sm:rounded-xl sm:pb-4 [&_[data-slot=dialog-close]]:top-3 [&_[data-slot=dialog-close]]:right-3 [&_[data-slot=dialog-close]]:size-10 sm:[&_[data-slot=dialog-close]]:top-2 sm:[&_[data-slot=dialog-close]]:right-2 sm:[&_[data-slot=dialog-close]]:size-7 [&_[data-slot=input]]:h-12 sm:[&_[data-slot=input]]:h-8 [&_[data-slot=select-trigger]]:h-12 sm:[&_[data-slot=select-trigger]]:h-8 [&_button[type=submit]]:h-12 [&_button[type=submit]]:w-full sm:[&_button[type=submit]]:h-8 sm:[&_button[type=submit]]:w-auto";

export function VaultManager({
  initialChromeImport,
  initialSetup,
  initialSnapshot,
}: {
  readonly initialChromeImport?: boolean;
  readonly initialSetup?: Extract<ManagerSetupRequest, { target: "vault" }>;
  readonly initialSnapshot: ManagerSnapshot;
}) {
  const managerMutation = api.manager.mutate.useMutation();
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const mutate = async (mutation: ManagerMutation) => {
    setBusy(true);
    setError(undefined);
    try {
      const nextSnapshot = await managerMutation.mutateAsync(mutation);
      setSnapshot(nextSnapshot);
      return true;
    } catch {
      setError("Unable to update the workspace. Try again.");
      return false;
    } finally {
      setBusy(false);
    }
  };
  const legacyItems = snapshot.vaultItems.filter(
    (item) =>
      item.kind === "identity" || item.kind === "token" || item.kind === "phone"
  );

  return (
    <div className="mx-auto flex w-full max-w-4xl min-w-0 flex-col gap-8 px-4 py-6 sm:px-6 sm:py-8">
      <h1 className="type-page-title">Vault</h1>

      {error ? (
        <Alert variant="destructive">
          <KeyRoundIcon />
          <AlertTitle>Vault unavailable</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {categories.map((category) => (
        <VaultCategory
          busy={busy}
          initialChromeImport={
            category.kind === "login" ? initialChromeImport : undefined
          }
          initialSetup={
            initialSetup?.kind === category.kind ? initialSetup : undefined
          }
          items={snapshot.vaultItems.filter(
            (item) => item.kind === category.kind
          )}
          key={category.kind}
          onDelete={mutate}
          onSubmit={mutate}
          {...category}
        />
      ))}

      {legacyItems.length > 0 ? (
        <section aria-labelledby="other-vault-heading" className="space-y-3">
          <h2
            className="type-caption text-muted-foreground uppercase"
            id="other-vault-heading"
          >
            Other
          </h2>
          <div className="divide-y divide-border/50 border-y border-border/50">
            {legacyItems.map((item) => (
              <VaultItemRow
                busy={busy}
                item={item}
                key={item.id}
                onDelete={mutate}
              />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function VaultCategory({
  addLabel,
  busy,
  initialChromeImport,
  initialSetup,
  items,
  kind,
  onDelete,
  onSubmit,
  title,
}: {
  readonly addLabel: string;
  readonly busy: boolean;
  readonly initialChromeImport?: boolean;
  readonly initialSetup?: Extract<ManagerSetupRequest, { target: "vault" }>;
  readonly items: ManagerSnapshot["vaultItems"];
  readonly kind: VaultCreateItemKind;
  readonly onDelete: (mutation: ManagerMutation) => Promise<boolean>;
  readonly onSubmit: (mutation: ManagerMutation) => Promise<boolean>;
  readonly title: string;
}) {
  const [open, setOpen] = useState(
    Boolean(initialSetup || initialChromeImport)
  );
  const [view, setView] = useState<"add" | "import" | "list">(
    initialChromeImport ? "import" : initialSetup ? "add" : "list"
  );
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
  const singularItem = kind === "payment" ? "card" : kind;

  const updateOpen = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setQuery("");
      setVisibleCount(VAULT_DIALOG_PAGE_SIZE);
      setView("list");
    }
  };

  return (
    <section aria-label={title}>
      <Dialog onOpenChange={updateOpen} open={open}>
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
        <DialogContent
          animated={false}
          className={
            view === "list"
              ? `${dialogContentClass} grid-rows-[auto_auto_minmax(0,1fr)_auto] overflow-hidden`
              : `${dialogContentClass} no-scrollbar overflow-y-auto`
          }
        >
          {view === "list" ? (
            <>
              <DialogHeader className="pr-10 sm:pr-6">
                <DialogTitle>{title}</DialogTitle>
                <DialogDescription>
                  {items.length > 0
                    ? `Search and manage ${items.length.toLocaleString()} saved ${title.toLocaleLowerCase()}.`
                    : `Add your first saved ${singularItem}.`}
                </DialogDescription>
              </DialogHeader>

              {items.length > 0 ? (
                <div className="relative">
                  <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Label className="sr-only" htmlFor={`vault-search-${kind}`}>
                    Search {title.toLocaleLowerCase()}
                  </Label>
                  <Input
                    className="pl-8"
                    id={`vault-search-${kind}`}
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
                      Math.min(
                        count + VAULT_DIALOG_PAGE_SIZE,
                        filteredItems.length
                      )
                    );
                  }
                }}
              >
                {visibleItems.length > 0 ? (
                  <div className="divide-y divide-border/50">
                    {visibleItems.map((item) => (
                      <VaultItemRow
                        busy={busy}
                        item={item}
                        key={item.id}
                        onDelete={onDelete}
                      />
                    ))}
                  </div>
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

              <div className="flex justify-end gap-2">
                {kind === "login" ? (
                  <Button
                    onClick={() => setView("import")}
                    type="button"
                    variant="outline"
                  >
                    Bulk import
                  </Button>
                ) : null}
                <Button onClick={() => setView("add")} type="button">
                  <PlusIcon />
                  {addLabel}
                </Button>
              </div>
            </>
          ) : (
            <>
              <Button
                className="w-fit transition-none active:translate-y-0"
                onClick={() => setView("list")}
                size="sm"
                type="button"
                variant="plain"
              >
                <ArrowLeftIcon />
                {title}
              </Button>
              {view === "import" ? (
                <ChromePasswordImportPanel
                  busy={busy}
                  onDone={() => setView("list")}
                  onImport={onSubmit}
                />
              ) : (
                <>
                  <DialogHeader className="pr-10 sm:pr-6">
                    <DialogTitle>
                      {initialSetup?.kind === "login"
                        ? `Add ${initialSetup.label}`
                        : addLabel}
                    </DialogTitle>
                    <DialogDescription>
                      {kind === "login"
                        ? "Enter the credentials you use to sign in."
                        : "Sensitive values are encrypted before database storage and are never returned after saving."}
                    </DialogDescription>
                  </DialogHeader>
                  {renderVaultForm({
                    busy,
                    initialIdentifierType:
                      initialSetup?.kind === "login"
                        ? initialSetup.identifierType
                        : undefined,
                    initialLabel: initialSetup?.label,
                    initialOrigin:
                      initialSetup?.kind === "login"
                        ? initialSetup.origin
                        : undefined,
                    kind,
                    onSaved: () => setView("list"),
                    onSubmit,
                  })}
                </>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}

function VaultItemRow({
  busy,
  item,
  onDelete,
}: {
  readonly busy: boolean;
  readonly item: ManagerSnapshot["vaultItems"][number];
  readonly onDelete: (mutation: ManagerMutation) => Promise<boolean>;
}) {
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
        disabled={busy}
        onClick={() => void onDelete({ action: "vault.delete", id: item.id })}
        size="icon-sm"
        type="button"
        variant="quiet"
      >
        <Trash2Icon />
      </Button>
    </div>
  );
}

function VaultItemIcon({
  item,
}: {
  readonly item: ManagerSnapshot["vaultItems"][number];
}) {
  const faviconUrl = loginFaviconUrl(item);
  return (
    <span className="relative flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted text-muted-foreground">
      <Globe2Icon className="size-4" />
      {faviconUrl ? (
        // Imported domains cannot be declared in Next Image configuration.
        // oxlint-disable-next-line nextjs/no-img-element
        <img
          alt=""
          className="absolute inset-0 size-full bg-background object-contain p-1"
          onError={(event) => event.currentTarget.remove()}
          referrerPolicy="no-referrer"
          src={faviconUrl}
        />
      ) : null}
    </span>
  );
}

function loginFaviconUrl(
  item: ManagerSnapshot["vaultItems"][number]
): string | undefined {
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

function renderVaultForm({
  busy,
  initialIdentifierType,
  initialLabel,
  initialOrigin,
  kind,
  onSaved,
  onSubmit,
}: {
  readonly busy: boolean;
  readonly initialIdentifierType?: "email" | "phone" | "username";
  readonly initialLabel?: string;
  readonly initialOrigin?: string;
  readonly kind: VaultCreateItemKind;
  readonly onSaved: () => void;
  readonly onSubmit: (mutation: ManagerMutation) => Promise<boolean>;
}) {
  const common = { busy, initialLabel, onSaved, onSubmit };
  switch (kind) {
    case "login":
      return (
        <LoginVaultForm
          {...common}
          initialIdentifierType={initialIdentifierType}
          initialOrigin={initialOrigin}
        />
      );
    case "payment":
      return <PaymentCardForm {...common} />;
    case "address":
      return <AddressVaultForm {...common} />;
    case "contact":
      return <ContactVaultForm {...common} />;
  }
}
