"use client";

import { ChevronsUpDownIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
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
import { Button } from "@/components/ui/button";
import type { ModelCatalogItem } from "@/lib/model-catalog";
import { api } from "@/trpc/client";

const priceFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
  minimumFractionDigits: 0,
  style: "currency",
  currency: "USD",
});

export function ModelSelector({ modelId }: { readonly modelId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const catalog = api.models.list.useQuery(undefined, {
    enabled: open,
    staleTime: 5 * 60 * 1000,
  });
  const mutateManager = api.manager.mutate.useMutation();
  const groupedModels = useMemo(() => {
    const groups = new Map<string, ModelCatalogItem[]>();
    for (const model of catalog.data ?? []) {
      const providerModels = groups.get(model.ownedBy) ?? [];
      providerModels.push(model);
      groups.set(model.ownedBy, providerModels);
    }
    return [...groups.entries()].sort(([left], [right]) =>
      left.localeCompare(right)
    );
  }, [catalog.data]);

  const select = async (selectedModelId: string) => {
    setBusy(true);
    setError(undefined);
    try {
      await mutateManager.mutateAsync({
        action: "model.select",
        modelId: selectedModelId,
      });
      setOpen(false);
      router.refresh();
    } catch {
      setError("Unable to update the workspace. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const catalogError =
    catalog.error instanceof Error ? catalog.error.message : error;

  return (
    <ModelSelectorRoot onOpenChange={setOpen} open={open}>
      <ModelSelectorTrigger
        render={
          <Button disabled={busy} size="sm" type="button" variant="outline" />
        }
      >
        <ModelSelectorLogo
          provider={providerLogo(modelId.split("/", 1)[0] ?? modelId)}
        />
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
            {catalog.isFetching
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
  return `${priceFormatter.format(model.pricing.input)} / ${priceFormatter.format(model.pricing.output)} per M`;
}
