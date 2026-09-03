"use client";

import { SparklesIcon } from "lucide-react";
import type { ProactionOverview } from "@/agent/lib/proactions/overview";
import { type Autonomy, autonomySchema } from "@/agent/lib/proactions/define";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { api } from "@/trpc/client";

const autonomyLabels: Record<Autonomy, string> = {
  auto: "Act, then tell me",
  notify: "Just tell me",
  propose: "Ask before acting",
};

export function ProactionRow({
  onChanged,
  proaction,
}: {
  readonly onChanged: () => void;
  readonly proaction: ProactionOverview["proactions"][number];
}) {
  const configure = api.proactions.configure.useMutation({
    onSuccess: onChanged,
  });
  const locked = proaction.state === "admin_disabled";
  const clamped = proaction.allowedAutonomy.length < 3;

  return (
    <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-muted/50 text-muted-foreground">
        <SparklesIcon />
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="type-label">{proaction.title}</p>
          <StateBadge proaction={proaction} />
        </div>
        <p className="type-caption text-muted-foreground">
          {proaction.description}
        </p>
        <p className="type-caption text-muted-foreground">
          {proaction.cadence}
          {proaction.nextRunAt && proaction.state === "active"
            ? ` · next ${formatWhen(proaction.nextRunAt)}`
            : ""}
          {proaction.lastError ? ` · last run failed` : ""}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <Select
          disabled={locked || configure.isPending || !proaction.enabled}
          onValueChange={(value) => {
            if (value === proaction.autonomy) return;
            configure.mutate({
              autonomy: autonomySchema.parse(value),
              proactionId: proaction.id,
            });
          }}
          value={proaction.autonomy}
        >
          <SelectTrigger
            aria-label={`${proaction.title} autonomy`}
            size="sm"
            title={
              clamped
                ? "Higher autonomy is limited by this deployment or by the behavior itself."
                : undefined
            }
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {proaction.allowedAutonomy.map((level) => (
              <SelectItem key={level} value={level}>
                {autonomyLabels[level]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Switch
          aria-label={`${proaction.title} enabled`}
          checked={proaction.enabled}
          disabled={locked || configure.isPending}
          onCheckedChange={(checked) => {
            configure.mutate({ enabled: checked, proactionId: proaction.id });
          }}
        />
      </div>
    </div>
  );
}

function StateBadge({
  proaction,
}: {
  readonly proaction: ProactionOverview["proactions"][number];
}) {
  if (proaction.state === "active") {
    return <Badge variant="success">Active</Badge>;
  }
  if (proaction.state === "waiting") {
    return (
      <Badge variant="warning">
        {proaction.waitingOn.join(", ") || "Waiting"}
      </Badge>
    );
  }
  if (proaction.state === "admin_disabled") {
    return <Badge variant="secondary">Off by deployment policy</Badge>;
  }
  return <Badge variant="outline">Off</Badge>;
}

function formatWhen(iso: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}
