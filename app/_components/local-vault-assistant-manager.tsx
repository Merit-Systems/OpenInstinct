"use client";

import {
  BotIcon,
  DatabaseIcon,
  KeyRoundIcon,
  LinkIcon,
  LockKeyholeIcon,
  PlusIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
  Trash2Icon,
} from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  type ConnectionProvider,
  connectionProviderSchema,
  type ManagerMutation,
  type ManagerSetupRequest,
  type ManagerSnapshot,
  managerSnapshotSchema,
  type VaultItemKind,
  vaultItemKindSchema,
} from "@/lib/manager";

const providerLabels: Record<ConnectionProvider, string> = {
  custom: "Custom service",
  email: "Email",
  kernel: "Kernel browser",
  "local-model": "Local model",
};

const vaultKindLabels: Record<VaultItemKind, string> = {
  identity: "Identity",
  login: "Login",
  payment: "Payment",
  token: "Token",
};

export function LocalVaultAssistantManager({
  initialSetup,
}: {
  readonly initialSetup?: ManagerSetupRequest;
}) {
  const [snapshot, setSnapshot] = useState<ManagerSnapshot>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setError(undefined);
    try {
      const response = await fetch("/api/manager", { cache: "no-store" });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(readApiError(body));
      setSnapshot(managerSnapshotSchema.parse(body));
    } catch (refreshError) {
      setError(toErrorMessage(refreshError));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const mutate = async (mutation: ManagerMutation) => {
    setBusy(true);
    setError(undefined);
    try {
      const response = await fetch("/api/manager", {
        body: JSON.stringify(mutation),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(readApiError(body));
      setSnapshot(managerSnapshotSchema.parse(body));
      return true;
    } catch (mutationError) {
      setError(toErrorMessage(mutationError));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const kernel = snapshot?.connections.find(
    (connection) => connection.provider === "kernel"
  );

  return (
    <main className="flex flex-col gap-12">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-2">
          <h1 className="type-page-title">Manager</h1>
          <p className="type-supporting-body text-muted-foreground">
            Manage private credentials, connections, and local inference on this
            device.
          </p>
        </div>
        <Button
          disabled={busy}
          onClick={() => void refresh()}
          size="sm"
          type="button"
          variant="outline"
        >
          <RefreshCwIcon className={busy ? "animate-spin" : undefined} />
          Refresh
        </Button>
      </header>

      {error ? (
        <Alert variant="destructive">
          <LockKeyholeIcon />
          <AlertTitle>Manager unavailable</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <section aria-labelledby="status-heading" className="space-y-3">
        <SectionHeading
          description="A quick read on the services available to the agent."
          id="status-heading"
          title="Local status"
        />
        <ul className="rounded-xl border border-border px-4">
          <StatusRow
            detail={snapshot?.runtime.inference ?? "Loading…"}
            icon={BotIcon}
            label="Inference"
            state={snapshot ? "Local-first" : "Checking"}
          />
          <StatusRow
            detail={kernel?.label ?? "Add a connection below"}
            icon={LinkIcon}
            label="Kernel"
            state={kernel?.hasSecret ? "Connected" : "Not connected"}
            variant={kernel?.hasSecret ? "success" : "warning"}
          />
          <StatusRow
            detail={snapshot?.secretStore.kind ?? "Checking host"}
            icon={ShieldCheckIcon}
            label="Secret store"
            state={
              snapshot?.secretStore.available ? "Available" : "Unavailable"
            }
            variant={snapshot?.secretStore.available ? "success" : "warning"}
          />
          <StatusRow
            detail="Values never render in this interface"
            icon={KeyRoundIcon}
            label="Vault"
            state={`${String(snapshot?.vaultItems.length ?? 0)} saved`}
          />
        </ul>
      </section>

      <Tabs
        defaultValue={
          initialSetup?.target === "vault" ? "vault" : "connections"
        }
      >
        <div className="overflow-x-auto">
          <TabsList
            aria-label="Manager sections"
            className="w-full justify-start border-b border-border"
            variant="line"
          >
            <TabsTrigger value="connections">Connections</TabsTrigger>
            <TabsTrigger value="vault">Auth vault</TabsTrigger>
            <TabsTrigger value="runtime">Runtime</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent className="pt-5" value="connections">
          <ConnectionSection
            busy={busy}
            initialSetup={
              initialSetup?.target === "connection" ? initialSetup : undefined
            }
            onDelete={mutate}
            onSubmit={mutate}
            snapshot={snapshot}
          />
        </TabsContent>

        <TabsContent className="pt-5" value="vault">
          <VaultSection
            busy={busy}
            initialSetup={
              initialSetup?.target === "vault" ? initialSetup : undefined
            }
            onDelete={mutate}
            onSubmit={mutate}
            snapshot={snapshot}
          />
        </TabsContent>

        <TabsContent className="pt-5" value="runtime">
          <RuntimeSection snapshot={snapshot} />
        </TabsContent>
      </Tabs>

      <aside className="border-l-2 border-information-border pl-4">
        <div className="flex items-start gap-3">
          <ShieldCheckIcon className="mt-0.5 size-4 shrink-0 text-information" />
          <div>
            <h2 className="type-label">Local vault boundary</h2>
            <p className="mt-1 type-supporting-body text-muted-foreground">
              Labels and opaque handles live in the local database. Secret
              values go directly to the OS keychain and are never returned by
              the manager API or placed in chat.
            </p>
          </div>
        </div>
      </aside>
    </main>
  );
}

function SectionHeading({
  action,
  description,
  id,
  title,
}: {
  readonly action?: React.ReactNode;
  readonly description: string;
  readonly id: string;
  readonly title: string;
}) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div className="space-y-1">
        <h2 className="type-section-title" id={id}>
          {title}
        </h2>
        <p className="type-supporting-body text-muted-foreground">
          {description}
        </p>
      </div>
      {action}
    </div>
  );
}

function StatusRow({
  detail,
  icon: Icon,
  label,
  state,
  variant = "information",
}: {
  readonly detail: string;
  readonly icon: typeof BotIcon;
  readonly label: string;
  readonly state: string;
  readonly variant?: "information" | "success" | "warning";
}) {
  return (
    <li className="flex min-w-0 items-center gap-3 border-b border-border py-3 last:border-b-0">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1 leading-tight">
        <p className="type-label">{label}</p>
        <p
          className="truncate type-caption text-muted-foreground"
          title={detail}
        >
          {detail}
        </p>
      </div>
      <Badge variant={variant}>{state}</Badge>
    </li>
  );
}

function ConnectionSection({
  busy,
  initialSetup,
  onDelete,
  onSubmit,
  snapshot,
}: {
  readonly busy: boolean;
  readonly initialSetup?: Extract<
    ManagerSetupRequest,
    { target: "connection" }
  >;
  readonly onDelete: (mutation: ManagerMutation) => Promise<boolean>;
  readonly onSubmit: (mutation: ManagerMutation) => Promise<boolean>;
  readonly snapshot?: ManagerSnapshot;
}) {
  return (
    <section aria-labelledby="connections-heading" className="space-y-3">
      <SectionHeading
        action={
          <ConnectionDialog
            busy={busy}
            initialSetup={initialSetup}
            onSubmit={onSubmit}
          />
        }
        description="Services this device allows the agent to use."
        id="connections-heading"
        title="Connections"
      />
      <ul className="rounded-xl border border-border px-4">
        {snapshot?.connections.length ? (
          snapshot.connections.map((connection) => (
            <li
              className="flex min-w-0 items-center gap-3 border-b border-border py-3 last:border-b-0"
              key={connection.id}
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <LinkIcon className="size-3.5" />
              </span>
              <div className="min-w-0 flex-1 leading-tight">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="type-label">{connection.label}</p>
                  <Badge
                    variant={
                      connection.hasSecret ||
                      connection.provider === "local-model"
                        ? "success"
                        : "warning"
                    }
                  >
                    {connection.hasSecret ||
                    connection.provider === "local-model"
                      ? "Ready"
                      : "No credential"}
                  </Badge>
                </div>
                <p className="truncate type-caption text-muted-foreground">
                  {providerLabels[connection.provider]}
                  {connection.account ? ` · ${connection.account}` : ""}
                  {connection.endpoint ? ` · ${connection.endpoint}` : ""}
                </p>
              </div>
              <Button
                aria-label={`Remove ${connection.label}`}
                disabled={busy}
                onClick={() =>
                  void onDelete({
                    action: "connection.delete",
                    id: connection.id,
                  })
                }
                size="icon-sm"
                type="button"
                variant="quiet"
              >
                <Trash2Icon />
              </Button>
            </li>
          ))
        ) : (
          <EmptyRow message="Add Kernel, a local model, email, or another service." />
        )}
      </ul>
    </section>
  );
}

function ConnectionDialog({
  busy,
  initialSetup,
  onSubmit,
}: {
  readonly busy: boolean;
  readonly initialSetup?: Extract<
    ManagerSetupRequest,
    { target: "connection" }
  >;
  readonly onSubmit: (mutation: ManagerMutation) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(Boolean(initialSetup));
  const [provider, setProvider] = useState<ConnectionProvider>(
    initialSetup?.provider ?? "kernel"
  );
  const [label, setLabel] = useState(
    initialSetup?.label ?? providerLabels[initialSetup?.provider ?? "kernel"]
  );
  const [endpoint, setEndpoint] = useState(initialSetup?.endpoint ?? "");
  const [account, setAccount] = useState(initialSetup?.account ?? "");
  const [secret, setSecret] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const saved = await onSubmit({
      action: "connection.create",
      input: { account, endpoint, label, provider, secret },
    });
    if (saved) {
      setAccount("");
      setEndpoint("");
      setSecret("");
      setOpen(false);
    }
  };

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger render={<Button size="sm" type="button" />}>
        <PlusIcon />
        Add
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add connection</DialogTitle>
          <DialogDescription>
            Enter the credential on this device. It goes straight to the local
            keychain and never enters the conversation.
          </DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={(event) => void submit(event)}>
          <div className="grid gap-2">
            <Label htmlFor="connection-provider">Provider</Label>
            <Select
              onValueChange={(value) => {
                const next = connectionProviderSchema.parse(value);
                setProvider(next);
                setLabel(providerLabels[next]);
                setAccount("");
                setEndpoint("");
              }}
              value={provider}
            >
              <SelectTrigger id="connection-provider">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(providerLabels).map(([value, text]) => (
                  <SelectItem key={value} value={value}>
                    {text}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Field
            id="connection-label"
            label="Name"
            onChange={setLabel}
            value={label}
          />
          <Field
            id="connection-account"
            label={provider === "local-model" ? "Model ID" : "Account label"}
            onChange={setAccount}
            placeholder={
              provider === "local-model" ? "qwen3.5:27b" : "Personal"
            }
            value={account}
          />
          {provider === "local-model" || provider === "custom" ? (
            <Field
              id="connection-endpoint"
              label="Endpoint"
              onChange={setEndpoint}
              placeholder={
                provider === "local-model"
                  ? "http://127.0.0.1:11434/v1"
                  : "https://api.example.com"
              }
              value={endpoint}
            />
          ) : null}
          <Field
            autoComplete="off"
            id="connection-secret"
            label={
              provider === "email"
                ? "Password or app token"
                : "API key or token"
            }
            onChange={setSecret}
            placeholder={
              provider === "local-model" ? "Optional" : "Stored in Keychain"
            }
            type="password"
            value={secret}
          />
          <DialogFooter>
            <Button disabled={busy || !label.trim()} type="submit">
              <PlusIcon />
              Add connection
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function VaultSection({
  busy,
  initialSetup,
  onDelete,
  onSubmit,
  snapshot,
}: {
  readonly busy: boolean;
  readonly initialSetup?: Extract<ManagerSetupRequest, { target: "vault" }>;
  readonly onDelete: (mutation: ManagerMutation) => Promise<boolean>;
  readonly onSubmit: (mutation: ManagerMutation) => Promise<boolean>;
  readonly snapshot?: ManagerSnapshot;
}) {
  return (
    <section aria-labelledby="vault-heading" className="space-y-3">
      <SectionHeading
        action={
          <VaultDialog
            busy={busy}
            initialSetup={initialSetup}
            onSubmit={onSubmit}
          />
        }
        description="Opaque credential handles available to local tools."
        id="vault-heading"
        title="Auth vault"
      />
      <ul className="rounded-xl border border-border px-4">
        {snapshot?.vaultItems.length ? (
          snapshot.vaultItems.map((item) => (
            <li
              className="flex min-w-0 items-center gap-3 border-b border-border py-3 last:border-b-0"
              key={item.id}
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <KeyRoundIcon className="size-3.5" />
              </span>
              <div className="min-w-0 flex-1 leading-tight">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="type-label">{item.label}</p>
                  <Badge variant={item.hasSecret ? "success" : "warning"}>
                    {item.hasSecret ? "Stored" : "Missing"}
                  </Badge>
                </div>
                <p className="truncate type-caption text-muted-foreground">
                  {vaultKindLabels[item.kind]}
                  {item.account ? ` · ${item.account}` : ""} · handle{" "}
                  {item.id.slice(0, 8)}
                </p>
              </div>
              <Button
                aria-label={`Remove ${item.label}`}
                disabled={busy}
                onClick={() =>
                  void onDelete({ action: "vault.delete", id: item.id })
                }
                size="icon-sm"
                type="button"
                variant="quiet"
              >
                <Trash2Icon />
              </Button>
            </li>
          ))
        ) : (
          <EmptyRow message="Save a login, identity, payment profile, or token on this device." />
        )}
      </ul>
    </section>
  );
}

function VaultDialog({
  busy,
  initialSetup,
  onSubmit,
}: {
  readonly busy: boolean;
  readonly initialSetup?: Extract<ManagerSetupRequest, { target: "vault" }>;
  readonly onSubmit: (mutation: ManagerMutation) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(Boolean(initialSetup));
  const [kind, setKind] = useState<VaultItemKind>(
    initialSetup?.kind ?? "login"
  );
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

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger render={<Button size="sm" type="button" />}>
        <PlusIcon />
        Add
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add vault item</DialogTitle>
          <DialogDescription>
            The secret is stored locally and is never returned after saving.
          </DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={(event) => void submit(event)}>
          <div className="grid gap-2">
            <Label htmlFor="vault-kind">Type</Label>
            <Select
              onValueChange={(value) =>
                setKind(vaultItemKindSchema.parse(value))
              }
              value={kind}
            >
              <SelectTrigger id="vault-kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(vaultKindLabels).map(([value, text]) => (
                  <SelectItem key={value} value={value}>
                    {text}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Field
            id="vault-label"
            label="Name"
            onChange={setLabel}
            placeholder="AMC personal login"
            value={label}
          />
          <Field
            id="vault-account"
            label="Account hint"
            onChange={setAccount}
            placeholder="ryan@example.com"
            value={account}
          />
          <Field
            autoComplete="new-password"
            id="vault-secret"
            label="Secret value"
            onChange={setSecret}
            placeholder="Stored in Keychain"
            type="password"
            value={secret}
          />
          <DialogFooter>
            <Button disabled={busy || !label.trim() || !secret} type="submit">
              <PlusIcon />
              Save to vault
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RuntimeSection({ snapshot }: { readonly snapshot?: ManagerSnapshot }) {
  return (
    <section aria-labelledby="runtime-heading" className="space-y-3">
      <SectionHeading
        description="The local Eve service owns sessions, policy, and secret access."
        id="runtime-heading"
        title="Runtime"
      />
      <dl className="rounded-xl border border-border px-4">
        <RuntimeRow label="Mode" value={snapshot?.runtime.mode ?? "Loading…"} />
        <RuntimeRow
          label="Model"
          value={snapshot?.runtime.inference ?? "Loading…"}
        />
        <RuntimeRow label="Metadata" value="Private local database" />
        <RuntimeRow
          label="Secrets"
          value={snapshot?.secretStore.kind ?? "Checking…"}
        />
      </dl>
      <p className="type-caption text-muted-foreground">
        New model settings apply to the next agent step.
      </p>
    </section>
  );
}

function RuntimeRow({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}) {
  return (
    <div className="flex items-center gap-3 border-b border-border py-3 last:border-b-0">
      <DatabaseIcon className="size-4 shrink-0 text-muted-foreground" />
      <dt className="type-label">{label}</dt>
      <dd
        className="ml-auto min-w-0 truncate type-supporting-body text-muted-foreground"
        title={value}
      >
        {value}
      </dd>
    </div>
  );
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

function EmptyRow({ message }: { readonly message: string }) {
  return (
    <li className="py-10 text-center">
      <p className="type-supporting-body text-muted-foreground">{message}</p>
    </li>
  );
}

function readApiError(value: unknown) {
  if (
    value &&
    typeof value === "object" &&
    "error" in value &&
    typeof value.error === "string"
  )
    return value.error;
  return "Manager request failed.";
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Manager request failed.";
}
