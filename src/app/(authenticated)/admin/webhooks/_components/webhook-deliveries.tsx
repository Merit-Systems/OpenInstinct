"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api } from "@/trpc/client";
import { AdminShell } from "../../_components/admin-shell";

export function WebhookDeliveries() {
  const [summary, setSummary] = useState<string>();
  const deliveries = api.admin.webhookDeliveries.useQuery({ limit: 100 });
  const drain = api.admin.drainWebhooks.useMutation({
    onSuccess: (result) => {
      setSummary(formatSummary(result));
      void deliveries.refetch();
    },
  });

  return (
    <AdminShell
      description="Recent delivery attempts and a controlled manual delivery drain."
      title="Webhooks"
    >
      <div className="flex flex-wrap items-center gap-3">
        <Button
          disabled={drain.isPending}
          onClick={() => drain.mutate({ limit: 50 })}
          type="button"
        >
          {drain.isPending ? "Draining…" : "Drain now"}
        </Button>
        {summary ? (
          <output className="type-supporting-body text-muted-foreground">
            {summary}
          </output>
        ) : null}
      </div>
      {drain.isError ? (
        <p className="type-supporting-body text-destructive" role="alert">
          Unable to drain webhook deliveries.
        </p>
      ) : null}
      {deliveries.isError ? (
        <p className="type-supporting-body text-destructive" role="alert">
          Unable to load webhook deliveries.
        </p>
      ) : null}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>When</TableHead>
            <TableHead>Event</TableHead>
            <TableHead>Endpoint</TableHead>
            <TableHead>Outcome</TableHead>
            <TableHead>Attempt</TableHead>
            <TableHead>Response</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {deliveries.data?.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} variant="empty">
                No deliveries yet.
              </TableCell>
            </TableRow>
          ) : null}
          {deliveries.data?.map((delivery) => (
            <TableRow key={delivery.id}>
              <TableCell>
                <time dateTime={delivery.createdAt}>
                  {formatDate(delivery.createdAt)}
                </time>
              </TableCell>
              <TableCell>{delivery.eventType}</TableCell>
              <TableCell
                className="max-w-64 truncate"
                title={delivery.endpointUrl}
              >
                {delivery.endpointUrl}
              </TableCell>
              <TableCell>
                <OutcomeBadge outcome={delivery.outcome} />
              </TableCell>
              <TableCell>{String(delivery.attempt)}</TableCell>
              <TableCell>
                {delivery.responseStatus
                  ? String(delivery.responseStatus)
                  : "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </AdminShell>
  );
}

function OutcomeBadge({ outcome }: { readonly outcome: string }) {
  const variant =
    outcome === "delivered"
      ? "success"
      : outcome === "pending"
        ? "information"
        : outcome === "dead"
          ? "destructive"
          : "warning";
  return <Badge variant={variant}>{outcome}</Badge>;
}

function formatSummary(summary: Record<string, number>) {
  return Object.entries(summary)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(" · ");
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
