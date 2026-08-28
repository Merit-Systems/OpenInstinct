"use client";

import { KeyRoundIcon, PlusIcon, Trash2Icon } from "lucide-react";
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
import type {
  ManagerMutation,
  ManagerSetupRequest,
  ManagerSnapshot,
  VaultCreateItemKind,
} from "@/lib/manager";
import { api } from "@/trpc/client";
import { AddressVaultForm } from "./address-vault-form";
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

export function VaultManager({
  initialSetup,
  initialSnapshot,
}: {
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
  const legacyItems =
    snapshot.vaultItems.filter(
      (item) =>
        item.kind === "identity" ||
        item.kind === "token" ||
        item.kind === "phone"
    ) ?? [];

  return (
    <div className="mx-auto flex w-full max-w-4xl min-w-0 flex-col gap-8 px-4 py-6 sm:px-6 sm:py-8">
      <h1 className="sr-only">Vault</h1>

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
          initialSetup={
            initialSetup?.kind === category.kind ? initialSetup : undefined
          }
          items={
            snapshot.vaultItems.filter((item) => item.kind === category.kind) ??
            []
          }
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
  initialSetup,
  items,
  kind,
  onDelete,
  onSubmit,
  title,
}: {
  readonly addLabel: string;
  readonly busy: boolean;
  readonly initialSetup?: Extract<ManagerSetupRequest, { target: "vault" }>;
  readonly items: ManagerSnapshot["vaultItems"];
  readonly kind: VaultCreateItemKind;
  readonly onDelete: (mutation: ManagerMutation) => Promise<boolean>;
  readonly onSubmit: (mutation: ManagerMutation) => Promise<boolean>;
  readonly title: string;
}) {
  const headingId = `vault-${kind}-heading`;

  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <h2
        className="type-caption text-muted-foreground uppercase"
        id={headingId}
      >
        {title}
      </h2>
      {items.length > 0 ? (
        <div className="divide-y divide-border/50 border-y border-border/50">
          {items.map((item) => (
            <VaultItemRow
              busy={busy}
              item={item}
              key={item.id}
              onDelete={onDelete}
            />
          ))}
        </div>
      ) : null}
      <VaultDialog
        addLabel={addLabel}
        busy={busy}
        initialSetup={initialSetup}
        key={
          initialSetup
            ? `setup:${initialSetup.kind}:${initialSetup.label ?? ""}:${
                initialSetup.kind === "login" ? initialSetup.identifierType : ""
              }:${initialSetup.kind === "login" ? initialSetup.origin : ""}`
            : "manual"
        }
        kind={kind}
        onSubmit={onSubmit}
      />
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

function VaultDialog({
  addLabel,
  busy,
  initialSetup,
  kind,
  onSubmit,
}: {
  readonly addLabel: string;
  readonly busy: boolean;
  readonly initialSetup?: Extract<ManagerSetupRequest, { target: "vault" }>;
  readonly kind: VaultCreateItemKind;
  readonly onSubmit: (mutation: ManagerMutation) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(Boolean(initialSetup));
  const onSaved = () => setOpen(false);

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger
        render={
          <Button
            className="h-14 w-full justify-start border-dashed text-muted-foreground"
            type="button"
            variant="outline"
          />
        }
      >
        <PlusIcon />
        {addLabel}
      </DialogTrigger>
      <DialogContent className="top-auto bottom-0 max-h-[calc(100dvh-0.5rem)] translate-y-0 overflow-y-auto overscroll-contain rounded-b-none pb-[max(1rem,env(safe-area-inset-bottom))] sm:top-1/2 sm:bottom-auto sm:max-h-[calc(100dvh-2rem)] sm:max-w-lg sm:-translate-y-1/2 sm:rounded-xl sm:pb-4 [&_[data-slot=dialog-close]]:top-3 [&_[data-slot=dialog-close]]:right-3 [&_[data-slot=dialog-close]]:size-10 sm:[&_[data-slot=dialog-close]]:top-2 sm:[&_[data-slot=dialog-close]]:right-2 sm:[&_[data-slot=dialog-close]]:size-7 [&_[data-slot=input]]:h-12 sm:[&_[data-slot=input]]:h-8 [&_[data-slot=select-trigger]]:h-12 sm:[&_[data-slot=select-trigger]]:h-8 [&_button[type=submit]]:h-12 [&_button[type=submit]]:w-full sm:[&_button[type=submit]]:h-8 sm:[&_button[type=submit]]:w-auto">
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
            initialSetup?.kind === "login" ? initialSetup.origin : undefined,
          kind,
          onSaved,
          onSubmit,
        })}
      </DialogContent>
    </Dialog>
  );
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
