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
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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

export function LocalVaultAssistantManager() {
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
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-10">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-2xl">
          <p className="type-label text-primary">Local control plane</p>
          <h1 className="mt-1 font-medium text-4xl tracking-tight">Manager</h1>
          <p className="mt-2 type-supporting-body text-muted-foreground">
            Control inference, browser connections, and private credentials from
            this device.
          </p>
        </div>
        <Button
          disabled={busy}
          onClick={() => void refresh()}
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

      <section
        aria-label="Local Vault Assistant status"
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
      >
        <StatusCard
          detail={snapshot?.runtime.inference ?? "Loading…"}
          icon={BotIcon}
          label="Inference"
          state={snapshot ? "Local-first" : "Checking"}
        />
        <StatusCard
          detail={kernel?.label ?? "Add a connection below"}
          icon={LinkIcon}
          label="Kernel"
          state={kernel?.hasSecret ? "Connected" : "Not connected"}
          variant={kernel?.hasSecret ? "success" : "warning"}
        />
        <StatusCard
          detail={snapshot?.secretStore.kind ?? "Checking host"}
          icon={ShieldCheckIcon}
          label="Secret store"
          state={snapshot?.secretStore.available ? "Available" : "Unavailable"}
          variant={snapshot?.secretStore.available ? "success" : "warning"}
        />
        <StatusCard
          detail="Secret values never render in this UI"
          icon={KeyRoundIcon}
          label="Vault"
          state={`${String(snapshot?.vaultItems.length ?? 0)} saved`}
        />
      </section>

      <Tabs defaultValue="connections">
        <TabsList aria-label="Manager sections" variant="line">
          <TabsTrigger value="connections">Connections</TabsTrigger>
          <TabsTrigger value="vault">Auth vault</TabsTrigger>
          <TabsTrigger value="runtime">Runtime</TabsTrigger>
        </TabsList>

        <TabsContent className="pt-4" value="connections">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_23rem]">
            <ConnectionList busy={busy} onDelete={mutate} snapshot={snapshot} />
            <ConnectionForm busy={busy} onSubmit={mutate} />
          </div>
        </TabsContent>

        <TabsContent className="pt-4" value="vault">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_23rem]">
            <VaultList busy={busy} onDelete={mutate} snapshot={snapshot} />
            <VaultForm busy={busy} onSubmit={mutate} />
          </div>
        </TabsContent>

        <TabsContent className="pt-4" value="runtime">
          <Card>
            <CardHeader>
              <CardTitle>Local runtime</CardTitle>
              <CardDescription>
                The local Eve service is the authority for sessions, policies,
                and secrets.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <RuntimeRow
                label="Mode"
                value={snapshot?.runtime.mode ?? "Loading…"}
              />
              <RuntimeRow
                label="Model"
                value={snapshot?.runtime.inference ?? "Loading…"}
              />
              <RuntimeRow label="Metadata" value="Private local database" />
              <RuntimeRow
                label="Secrets"
                value={snapshot?.secretStore.kind ?? "Checking…"}
              />
              <p className="type-supporting-body text-muted-foreground sm:col-span-2">
                New model settings apply to the next agent step.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Alert variant="information">
        <ShieldCheckIcon />
        <AlertTitle>Local vault boundary</AlertTitle>
        <AlertDescription>
          The manager stores labels and opaque handles in the local database.
          Secret values are written directly to the OS keychain and are never
          returned by the manager API.
        </AlertDescription>
      </Alert>
    </main>
  );
}

function StatusCard({
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
    <Card size="sm">
      <CardHeader>
        <div className="flex items-center gap-2 text-muted-foreground">
          <Icon className="size-4" />
          <span className="type-label">{label}</span>
        </div>
        <CardAction>
          <Badge variant={variant}>{state}</Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="truncate text-muted-foreground" title={detail}>
        {detail}
      </CardContent>
    </Card>
  );
}

function ConnectionList({
  busy,
  onDelete,
  snapshot,
}: {
  readonly busy: boolean;
  readonly onDelete: (mutation: ManagerMutation) => Promise<boolean>;
  readonly snapshot?: ManagerSnapshot;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Connections</CardTitle>
        <CardDescription>
          Services the local agent is allowed to use.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {snapshot?.connections.length ? (
          <div className="divide-y">
            {snapshot.connections.map((connection) => (
              <div
                className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
                key={connection.id}
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <LinkIcon className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
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
                  <p className="truncate text-muted-foreground">
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
                  size="icon"
                  type="button"
                  variant="ghost"
                >
                  <Trash2Icon />
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={LinkIcon}
            message="Add Kernel, a local model, email, or another service."
            title="No connections yet"
          />
        )}
      </CardContent>
    </Card>
  );
}

function ConnectionForm({
  busy,
  onSubmit,
}: {
  readonly busy: boolean;
  readonly onSubmit: (mutation: ManagerMutation) => Promise<boolean>;
}) {
  const [provider, setProvider] = useState<ConnectionProvider>("kernel");
  const [label, setLabel] = useState("Kernel browser");
  const [endpoint, setEndpoint] = useState("");
  const [account, setAccount] = useState("");
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
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add connection</CardTitle>
        <CardDescription>
          Credentials go straight to the local keychain.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4" onSubmit={(event) => void submit(event)}>
          <div className="grid gap-2">
            <Label htmlFor="connection-provider">Provider</Label>
            <Select
              onValueChange={(value) => {
                const next = connectionProviderSchema.parse(value);
                setProvider(next);
                setLabel(providerLabels[next]);
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
          <Field
            id="connection-endpoint"
            label="Endpoint"
            onChange={setEndpoint}
            placeholder={
              provider === "local-model"
                ? "http://127.0.0.1:11434/v1"
                : "Optional"
            }
            value={endpoint}
          />
          <Field
            autoComplete="off"
            id="connection-secret"
            label="API key or token"
            onChange={setSecret}
            placeholder={
              provider === "local-model" ? "Optional" : "Stored in Keychain"
            }
            type="password"
            value={secret}
          />
          <Button disabled={busy || !label.trim()} type="submit">
            <PlusIcon />
            Add connection
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function VaultList({
  busy,
  onDelete,
  snapshot,
}: {
  readonly busy: boolean;
  readonly onDelete: (mutation: ManagerMutation) => Promise<boolean>;
  readonly snapshot?: ManagerSnapshot;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Auth vault</CardTitle>
        <CardDescription>
          Opaque credential handles available to local tools.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {snapshot?.vaultItems.length ? (
          <div className="divide-y">
            {snapshot.vaultItems.map((item) => (
              <div
                className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
                key={item.id}
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <KeyRoundIcon className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="type-label">{item.label}</p>
                    <Badge variant={item.hasSecret ? "success" : "warning"}>
                      {item.hasSecret ? "Stored" : "Missing"}
                    </Badge>
                  </div>
                  <p className="truncate text-muted-foreground">
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
                  size="icon"
                  type="button"
                  variant="ghost"
                >
                  <Trash2Icon />
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={KeyRoundIcon}
            message="Save a login, identity, payment profile, or token on this device."
            title="Vault is empty"
          />
        )}
      </CardContent>
    </Card>
  );
}

function VaultForm({
  busy,
  onSubmit,
}: {
  readonly busy: boolean;
  readonly onSubmit: (mutation: ManagerMutation) => Promise<boolean>;
}) {
  const [kind, setKind] = useState<VaultItemKind>("login");
  const [label, setLabel] = useState("");
  const [account, setAccount] = useState("");
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
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add vault item</CardTitle>
        <CardDescription>
          The value is never returned after saving.
        </CardDescription>
      </CardHeader>
      <CardContent>
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
          <Button disabled={busy || !label.trim() || !secret} type="submit">
            <PlusIcon />
            Save to vault
          </Button>
        </form>
      </CardContent>
    </Card>
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

function EmptyState({
  icon: Icon,
  message,
  title,
}: {
  readonly icon: typeof LinkIcon;
  readonly message: string;
  readonly title: string;
}) {
  return (
    <div className="flex min-h-52 flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-6 text-center">
      <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-4" />
      </span>
      <div>
        <p className="type-label">{title}</p>
        <p className="mt-1 text-muted-foreground">{message}</p>
      </div>
    </div>
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
    <div className="flex items-start gap-3 rounded-lg border p-3">
      <DatabaseIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <p className="type-label">{label}</p>
        <p className="truncate text-muted-foreground" title={value}>
          {value}
        </p>
      </div>
    </div>
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
