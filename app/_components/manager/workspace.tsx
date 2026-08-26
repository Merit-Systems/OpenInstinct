"use client";

import {
  AppWindowIcon,
  BotIcon,
  ChevronsUpDownIcon,
  KeyRoundIcon,
  MailIcon,
  MessageSquareIcon,
  SendIcon,
} from "lucide-react";
import Link from "next/link";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import {
  ModelSelector as ModelSelectorRoot,
  ModelSelectorContent,
  ModelSelectorEmpty,
  ModelSelectorGroup,
  ModelSelectorInput,
  ModelSelectorItem,
  ModelSelectorList,
  ModelSelectorLogo,
  ModelSelectorShortcut,
  ModelSelectorTrigger,
} from "@/components/ai-elements/model-selector";
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
import type { ManagerMutation, ManagerSetupRequest } from "@/lib/manager";
import type { ModelCatalogItem } from "@/lib/model-catalog";
import { modelCatalogSchema } from "@/lib/model-catalog";
import { useManager } from "./use-manager";

const priceFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
  minimumFractionDigits: 0,
  style: "currency",
  currency: "USD",
});

export function WorkspaceManager({
  initialSetup,
}: {
  readonly initialSetup?: Extract<
    ManagerSetupRequest,
    { target: "connection" }
  >;
}) {
  const { busy, error, mutate, snapshot } = useManager();
  const kernel = snapshot?.connections.find(
    (connection) => connection.provider === "kernel"
  );
  const kernelSetup =
    initialSetup?.provider === "kernel" ? initialSetup : undefined;

  return (
    <main className="flex min-w-0 flex-col gap-8">
      <h1 className="sr-only">Workspace</h1>

      {error ? (
        <Alert variant="destructive">
          <KeyRoundIcon />
          <AlertTitle>Workspace unavailable</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <ChannelsSection kernelConnected={Boolean(kernel?.hasSecret)} />

      <section aria-labelledby="connectors-heading" className="space-y-3">
        <h2 className="type-section-title" id="connectors-heading">
          Connectors
        </h2>
        <div className="divide-y divide-border/50 border-y border-border/50">
          <ConnectorRow
            action={
              <div className="flex shrink-0 items-center gap-2">
                <span className="type-caption text-muted-foreground">
                  {kernel?.hasSecret ? "Connected" : "Not connected"}
                </span>
                <KernelDialog
                  busy={busy}
                  connected={Boolean(kernel?.hasSecret)}
                  initialSetup={kernelSetup}
                  onSubmit={mutate}
                />
              </div>
            }
            description="Browser sessions, Playwright, and proxy access."
            icon={AppWindowIcon}
            label="Kernel browser"
          />
          <ConnectorRow
            action={
              <div className="flex shrink-0 items-center gap-2">
                <span className="type-caption text-muted-foreground">
                  {snapshot?.runtime.source === "local" ? "Local" : "Gateway"}
                </span>
                <LocalModelDialog busy={busy} onSubmit={mutate} />
                <ModelSelector
                  busy={busy}
                  modelId={snapshot?.runtime.inference}
                  onSubmit={mutate}
                />
              </div>
            }
            description={
              snapshot?.runtime.inference ?? "Loading the current model…"
            }
            icon={BotIcon}
            label="Model"
          />
        </div>
      </section>
    </main>
  );
}

function ChannelsSection({
  kernelConnected,
}: {
  readonly kernelConnected: boolean;
}) {
  return (
    <section aria-labelledby="channels-heading" className="space-y-3">
      <h2 className="type-section-title" id="channels-heading">
        Channels
      </h2>
      <div className="grid gap-2 sm:grid-cols-3">
        {kernelConnected ? (
          <Button
            className="h-11 justify-start"
            render={<Link href="/chat" />}
            variant="outline"
          >
            <MessageSquareIcon />
            WebChat
          </Button>
        ) : (
          <Button className="h-11 justify-start" disabled variant="outline">
            <MessageSquareIcon />
            WebChat
          </Button>
        )}
        <Button className="h-11 justify-start" disabled variant="outline">
          <MailIcon />
          iMessage
        </Button>
        <Button className="h-11 justify-start" disabled variant="outline">
          <SendIcon />
          Telegram
        </Button>
      </div>
      {!kernelConnected ? (
        <p className="type-caption text-muted-foreground">
          Connect Kernel to enable WebChat. iMessage and Telegram are not yet
          available.
        </p>
      ) : (
        <p className="type-caption text-muted-foreground">
          iMessage and Telegram are not yet available.
        </p>
      )}
    </section>
  );
}

function ConnectorRow({
  action,
  description,
  icon: Icon,
  label,
}: {
  readonly action: React.ReactNode;
  readonly description: string;
  readonly icon: typeof BotIcon;
  readonly label: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3 py-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="type-label">{label}</p>
        <p className="type-supporting-body truncate text-muted-foreground">
          {description}
        </p>
      </div>
      {action}
    </div>
  );
}

function KernelDialog({
  busy,
  connected,
  initialSetup,
  onSubmit,
}: {
  readonly busy: boolean;
  readonly connected: boolean;
  readonly initialSetup?: Extract<
    ManagerSetupRequest,
    { target: "connection" }
  >;
  readonly onSubmit: (mutation: ManagerMutation) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(Boolean(initialSetup));
  const [secret, setSecret] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const saved = await onSubmit({
      action: "connection.create",
      input: {
        account: initialSetup?.account ?? "",
        endpoint: "",
        label: initialSetup?.label ?? "Kernel browser",
        provider: "kernel",
        secret,
      },
    });
    if (saved) {
      setSecret("");
      setOpen(false);
    }
  };

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger
        render={<Button size="sm" type="button" variant="outline" />}
      >
        {connected ? "Change" : "Connect"}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {connected ? "Replace Kernel key" : "Connect Kernel"}
          </DialogTitle>
          <DialogDescription>
            The key is saved directly to macOS Keychain.
          </DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={(event) => void submit(event)}>
          <Field
            autoComplete="off"
            id="kernel-api-key"
            label="Kernel API key"
            onChange={setSecret}
            placeholder={
              connected ? "Enter a replacement key" : "Paste your key"
            }
            type="password"
            value={secret}
          />
          <DialogFooter>
            <Button disabled={busy || !secret.trim()} type="submit">
              {connected ? "Replace key" : "Connect"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function LocalModelDialog({
  busy,
  onSubmit,
}: {
  readonly busy: boolean;
  readonly onSubmit: (mutation: ManagerMutation) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [modelId, setModelId] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [secret, setSecret] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const saved = await onSubmit({
      action: "connection.create",
      input: {
        account: modelId,
        endpoint,
        label: "Local model",
        provider: "local-model",
        secret,
      },
    });
    if (saved) {
      setSecret("");
      setOpen(false);
    }
  };

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger
        render={<Button size="sm" type="button" variant="quiet" />}
      >
        Local
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Use a local model</DialogTitle>
          <DialogDescription>
            Connect an OpenAI-compatible endpoint running on this device.
          </DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={(event) => void submit(event)}>
          <Field
            id="local-model-id"
            label="Model ID"
            onChange={setModelId}
            placeholder="qwen3.5:27b"
            value={modelId}
          />
          <Field
            id="local-model-endpoint"
            label="Endpoint"
            onChange={setEndpoint}
            placeholder="http://127.0.0.1:11434/v1"
            value={endpoint}
          />
          <Field
            autoComplete="off"
            id="local-model-key"
            label="API key (optional)"
            onChange={setSecret}
            type="password"
            value={secret}
          />
          <DialogFooter>
            <Button
              disabled={busy || !modelId.trim() || !endpoint.trim()}
              type="submit"
            >
              Use local model
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ModelSelector({
  busy,
  modelId,
  onSubmit,
}: {
  readonly busy: boolean;
  readonly modelId?: string;
  readonly onSubmit: (mutation: ManagerMutation) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<ModelCatalogItem[]>([]);
  const [catalogError, setCatalogError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const groupedModels = useMemo(() => {
    const groups = new Map<string, ModelCatalogItem[]>();
    for (const model of models) {
      const providerModels = groups.get(model.ownedBy) ?? [];
      providerModels.push(model);
      groups.set(model.ownedBy, providerModels);
    }
    return [...groups.entries()].sort(([left], [right]) =>
      left.localeCompare(right)
    );
  }, [models]);

  useEffect(() => {
    if (!open || models.length > 0 || loading) return;
    setLoading(true);
    setCatalogError(undefined);
    void fetch("/api/models", { cache: "no-store" })
      .then(async (response) => {
        const body: unknown = await response.json();
        if (!response.ok) throw new Error("The model catalog is unavailable.");
        setModels(modelCatalogSchema.parse(body));
      })
      .catch((error: unknown) => {
        setCatalogError(
          error instanceof Error
            ? error.message
            : "The model catalog is unavailable."
        );
      })
      .finally(() => setLoading(false));
  }, [loading, models.length, open]);

  const select = async (selectedModelId: string) => {
    const saved = await onSubmit({
      action: "model.select",
      modelId: selectedModelId,
    });
    if (saved) setOpen(false);
  };

  return (
    <ModelSelectorRoot onOpenChange={setOpen} open={open}>
      <ModelSelectorTrigger
        render={
          <Button disabled={busy} size="sm" type="button" variant="outline" />
        }
      >
        {modelId ? (
          <ModelSelectorLogo
            provider={providerLogo(modelId.split("/", 1)[0] ?? modelId)}
          />
        ) : null}
        Choose
        <ChevronsUpDownIcon />
      </ModelSelectorTrigger>
      <ModelSelectorContent
        className="sm:max-w-xl"
        showCloseButton
        title="Choose a model"
      >
        <ModelSelectorInput placeholder="Search models…" />
        <ModelSelectorList className="max-h-[min(32rem,70vh)]">
          <ModelSelectorEmpty className="px-3 text-left text-muted-foreground">
            {loading
              ? "Loading models…"
              : (catalogError ?? "No matching models.")}
          </ModelSelectorEmpty>
          {groupedModels.map(([provider, providerModels]) => (
            <ModelSelectorGroup heading={provider} key={provider}>
              {providerModels.map((model) => (
                <ModelSelectorItem
                  data-checked={model.id === modelId}
                  key={model.id}
                  onSelect={() => void select(model.id)}
                  value={`${model.name} ${model.id} ${model.ownedBy}`}
                >
                  <ModelSelectorLogo provider={providerLogo(model.ownedBy)} />
                  <span className="min-w-0 flex-1 text-left">
                    <span className="block truncate">{model.name}</span>
                    <span className="block truncate type-caption text-muted-foreground">
                      {model.id}
                    </span>
                  </span>
                  {formatPricing(model) ? (
                    <ModelSelectorShortcut>
                      {formatPricing(model)}
                    </ModelSelectorShortcut>
                  ) : null}
                </ModelSelectorItem>
              ))}
            </ModelSelectorGroup>
          ))}
        </ModelSelectorList>
      </ModelSelectorContent>
    </ModelSelectorRoot>
  );
}

function providerLogo(provider: string) {
  if (provider === "amazon") return "amazon-bedrock";
  if (provider === "meta") return "llama";
  if (provider === "spacexai") return "xai";
  return provider;
}

function formatPricing(model: ModelCatalogItem) {
  if (model.pricing?.input === undefined || model.pricing.output === undefined)
    return;
  return `${priceFormatter.format(model.pricing.input)} / ${priceFormatter.format(
    model.pricing.output
  )} per M`;
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
