"use client";

import {
  BotIcon,
  ChevronsUpDownIcon,
  CloudIcon,
  KeyRoundIcon,
  MailIcon,
  MessageSquareIcon,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
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
import type { ManagerMutation } from "@/lib/manager";
import type { ModelCatalogItem } from "@/app/_lib/model-catalog";
import { modelCatalogSchema } from "@/app/_lib/model-catalog";
import { useManager } from "./use-manager";

const priceFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
  minimumFractionDigits: 0,
  style: "currency",
  currency: "USD",
});

const LINQ_PHONE_NUMBER = "+12052611117";

export function WorkspaceManager() {
  const { busy, error, mutate, snapshot } = useManager();
  const browserReady = snapshot?.browser.available === true;

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

      <ChannelsSection browserReady={browserReady} />

      <section aria-labelledby="connectors-heading" className="space-y-3">
        <h2 className="type-section-title" id="connectors-heading">
          Infrastructure
        </h2>
        <div className="divide-y divide-border/50 border-y border-border/50">
          <ConnectorRow
            action={
              <span className="type-caption text-muted-foreground">
                {browserReady ? "Connected" : "Unavailable"}
              </span>
            }
            description="Run isolated browsers in your Kernel account."
            icon={<CloudIcon />}
            label="Kernel browser"
          />
          <ConnectorRow
            action={
              <ModelSelector
                busy={busy}
                modelId={snapshot?.runtime.inference}
                onSubmit={mutate}
              />
            }
            description={
              snapshot?.runtime.inference ?? "Loading the current model…"
            }
            icon={<BotIcon />}
            label="AI Gateway model"
          />
        </div>
      </section>
    </main>
  );
}

function ChannelsSection({ browserReady }: { readonly browserReady: boolean }) {
  return (
    <section aria-labelledby="channels-heading" className="space-y-3">
      <h2 className="type-section-title" id="channels-heading">
        Channels
      </h2>
      <div className="grid gap-2 sm:grid-cols-2">
        {browserReady ? (
          <Button
            className="h-11 justify-start"
            nativeButton={false}
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
        <Button
          className="h-11 justify-start"
          nativeButton={false}
          render={<a href={`sms:${LINQ_PHONE_NUMBER}`} />}
          variant="outline"
        >
          <MailIcon />
          iMessage
        </Button>
      </div>
      <p className="type-caption text-muted-foreground">
        {browserReady
          ? "WebChat is ready. iMessage opens +1 (205) 261-1117."
          : "iMessage opens +1 (205) 261-1117. KERNEL_API_KEY is required to enable WebChat."}
      </p>
    </section>
  );
}

function ConnectorRow({
  action,
  description,
  icon,
  label,
}: {
  readonly action: ReactNode;
  readonly description: string;
  readonly icon: ReactNode;
  readonly label: string;
}) {
  return (
    <div className="flex items-center gap-3 py-4">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-muted/50 text-muted-foreground">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="type-label">{label}</p>
        <p className="truncate type-caption text-muted-foreground">
          {description}
        </p>
      </div>
      {action}
    </div>
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

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen || models.length > 0 || loading) return;
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
  };

  const select = async (selectedModelId: string) => {
    const saved = await onSubmit({
      action: "model.select",
      modelId: selectedModelId,
    });
    if (saved) setOpen(false);
  };

  return (
    <ModelSelectorRoot onOpenChange={handleOpenChange} open={open}>
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
