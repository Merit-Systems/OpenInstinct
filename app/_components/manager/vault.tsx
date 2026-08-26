"use client";

import { KeyRoundIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
  VaultItemKind,
} from "@/lib/manager";
import { useManager } from "./use-manager";

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
    addLabel: "Add phone",
    kind: "phone",
    title: "Phones",
  },
] as const;

export function VaultManager({
  initialSetup,
}: {
  readonly initialSetup?: Extract<ManagerSetupRequest, { target: "vault" }>;
}) {
  const { busy, error, mutate, snapshot } = useManager();
  const legacyItems =
    snapshot?.vaultItems.filter(
      (item) => item.kind === "identity" || item.kind === "token"
    ) ?? [];

  return (
    <main className="flex min-w-0 flex-col gap-8">
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
            snapshot?.vaultItems.filter(
              (item) => item.kind === category.kind
            ) ?? []
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
    </main>
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
  readonly kind: "address" | "login" | "payment" | "phone";
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
  readonly kind: "address" | "login" | "payment" | "phone";
  readonly onSubmit: (mutation: ManagerMutation) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(Boolean(initialSetup));
  const [label, setLabel] = useState(initialSetup?.label ?? "");
  const [account, setAccount] = useState(initialSetup?.account ?? "");
  const [secret, setSecret] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const saved = await onSubmit({
      action: "vault.create",
      input: { account, kind, label, secret },
    });
    if (saved) {
      setAccount("");
      setLabel("");
      setSecret("");
      setOpen(false);
    }
  };

  const fields = fieldPresentation(kind);

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
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{addLabel}</DialogTitle>
          <DialogDescription>
            This value is stored locally and is never returned after saving.
          </DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={(event) => void submit(event)}>
          <Field
            id={`vault-${kind}-label`}
            label="Name"
            onChange={setLabel}
            placeholder={fields.labelPlaceholder}
            value={label}
          />
          {fields.accountLabel ? (
            <Field
              id={`vault-${kind}-account`}
              label={fields.accountLabel}
              onChange={setAccount}
              placeholder={fields.accountPlaceholder}
              value={account}
            />
          ) : null}
          <Field
            autoComplete={kind === "login" ? "new-password" : "off"}
            id={`vault-${kind}-secret`}
            label={fields.secretLabel}
            onChange={setSecret}
            placeholder={fields.secretPlaceholder}
            type={kind === "login" || kind === "payment" ? "password" : "text"}
            value={secret}
          />
          <DialogFooter>
            <Button
              disabled={busy || !label.trim() || !secret.trim()}
              type="submit"
            >
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function fieldPresentation(kind: VaultItemKind) {
  switch (kind) {
    case "login":
      return {
        accountLabel: "Username or email",
        accountPlaceholder: "name@example.com",
        labelPlaceholder: "GitHub",
        secretLabel: "Password",
        secretPlaceholder: "Password",
      };
    case "payment":
      return {
        accountLabel: "Cardholder or last four",
        accountPlaceholder: "Personal · 4242",
        labelPlaceholder: "Personal Visa",
        secretLabel: "Card details",
        secretPlaceholder: "Card number and expiration",
      };
    case "address":
      return {
        accountLabel: undefined,
        accountPlaceholder: undefined,
        labelPlaceholder: "Home",
        secretLabel: "Address",
        secretPlaceholder: "Street, city, region, and postal code",
      };
    case "phone":
      return {
        accountLabel: undefined,
        accountPlaceholder: undefined,
        labelPlaceholder: "Mobile",
        secretLabel: "Phone number",
        secretPlaceholder: "+1 555 555 5555",
      };
    default:
      return {
        accountLabel: "Account hint",
        accountPlaceholder: undefined,
        labelPlaceholder: "Credential",
        secretLabel: "Value",
        secretPlaceholder: "Stored in Keychain",
      };
  }
}

function Field({
  autoComplete,
  id,
  label,
  onChange,
  placeholder,
  type = "text",
  value,
}: {
  readonly autoComplete?: string;
  readonly id: string;
  readonly label: string;
  readonly onChange: (value: string) => void;
  readonly placeholder?: string;
  readonly type?: "password" | "text";
  readonly value: string;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        autoComplete={autoComplete}
        id={id}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        type={type}
        value={value}
      />
    </div>
  );
}
