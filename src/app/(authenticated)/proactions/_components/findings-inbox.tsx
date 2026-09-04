"use client";

import type { ProactionOverview } from "@/agent/lib/proactions/overview";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/trpc/client";

export function FindingsInbox({
  findings,
  onChanged,
  proactions,
}: {
  readonly findings: ProactionOverview["findings"];
  readonly onChanged: () => void;
  readonly proactions: ProactionOverview["proactions"];
}) {
  const resolve = api.proactions.resolveFinding.useMutation({
    onSuccess: onChanged,
  });
  const titles = new Map(
    proactions.map((proaction) => [proaction.id, proaction.title])
  );

  if (findings.length === 0) {
    return (
      <p className="type-caption text-muted-foreground">
        Nothing yet. Findings show up here as your proactions notice things.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-border/50 border-y border-border/50">
      {findings.map((finding) => {
        const open = finding.status === "new" || finding.status === "delivered";
        return (
          <li
            className="flex flex-col gap-2 py-4 sm:flex-row sm:items-start"
            key={finding.id}
          >
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="type-label">
                  {titles.get(finding.proactionId) ?? finding.proactionId}
                </p>
                {finding.urgency === "time_sensitive" ? (
                  <Badge variant="warning">Time sensitive</Badge>
                ) : null}
                {!open ? (
                  <Badge variant="outline">{statusLabel(finding.status)}</Badge>
                ) : null}
              </div>
              <p className="type-body">{finding.summary}</p>
              {finding.proposedAction ? (
                <p className="type-caption text-muted-foreground">
                  Proposed: {finding.proposedAction}
                </p>
              ) : null}
              <p className="type-caption text-muted-foreground">
                {new Intl.DateTimeFormat(undefined, {
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(new Date(finding.createdAt))}
              </p>
            </div>
            {open ? (
              <div className="flex shrink-0 gap-2">
                {finding.proposedAction ? (
                  <Button
                    disabled={resolve.isPending}
                    onClick={() => {
                      resolve.mutate({
                        findingId: finding.id,
                        status: "acted",
                      });
                    }}
                    size="sm"
                    variant="outline"
                  >
                    Done
                  </Button>
                ) : null}
                <Button
                  disabled={resolve.isPending}
                  onClick={() => {
                    resolve.mutate({
                      findingId: finding.id,
                      status: "dismissed",
                    });
                  }}
                  size="sm"
                  variant="ghost"
                >
                  Dismiss
                </Button>
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function statusLabel(status: ProactionOverview["findings"][number]["status"]) {
  switch (status) {
    case "acted":
      return "Done";
    case "dismissed":
      return "Dismissed";
    case "expired":
      return "Expired";
    default:
      return status;
  }
}
