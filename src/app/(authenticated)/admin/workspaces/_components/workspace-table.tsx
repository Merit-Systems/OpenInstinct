"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

const nextLifecycleState = {
  active: "suspended",
  suspended: "active",
} as const;

export function WorkspaceTable() {
  const [cursor, setCursor] = useState<string | undefined>();
  const [pending, setPending] = useState<{
    id: string;
    displayName: string | null;
    to: "active" | "suspended";
  }>();
  const workspaces = api.admin.workspaces.useQuery({ cursor, limit: 50 });
  const transition = api.admin.transitionLifecycle.useMutation({
    onSuccess: () => {
      setPending(undefined);
      void workspaces.refetch();
    },
  });

  return (
    <AdminShell
      description="Workspace lifecycle, membership, and this month’s model token use."
      title="Workspaces"
    >
      {workspaces.isError ? (
        <p className="type-supporting-body text-destructive" role="alert">
          Unable to load workspaces.
        </p>
      ) : null}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Workspace</TableHead>
            <TableHead>Plan</TableHead>
            <TableHead>Lifecycle</TableHead>
            <TableHead>Members</TableHead>
            <TableHead>Agents</TableHead>
            <TableHead>Model tokens</TableHead>
            <TableHead>Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {workspaces.data?.workspaces.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} variant="empty">
                No workspaces yet.
              </TableCell>
            </TableRow>
          ) : null}
          {workspaces.data?.workspaces.map((workspace) => {
            const target =
              workspace.lifecycleState in nextLifecycleState
                ? nextLifecycleState[
                    workspace.lifecycleState as keyof typeof nextLifecycleState
                  ]
                : undefined;
            return (
              <TableRow key={workspace.id}>
                <TableCell>
                  <div className="type-label">
                    {workspace.displayName ?? workspace.id}
                  </div>
                  <div className="type-compact-code text-muted-foreground">
                    {workspace.id}
                  </div>
                </TableCell>
                <TableCell>{workspace.plan}</TableCell>
                <TableCell>
                  <LifecycleBadge state={workspace.lifecycleState} />
                </TableCell>
                <TableCell>{String(workspace.memberCount)}</TableCell>
                <TableCell>{String(workspace.agentCount)}</TableCell>
                <TableCell className="type-numeric">
                  {String(workspace.modelTokens)}
                </TableCell>
                <TableCell>
                  {target ? (
                    <Button
                      onClick={() =>
                        setPending({
                          id: workspace.id,
                          displayName: workspace.displayName,
                          to: target,
                        })
                      }
                      size="sm"
                      type="button"
                      variant={
                        target === "suspended" ? "destructive" : "outline"
                      }
                    >
                      {target === "suspended" ? "Suspend" : "Reactivate"}
                    </Button>
                  ) : (
                    <span className="type-caption text-muted-foreground">
                      No action
                    </span>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {workspaces.data?.nextCursor ? (
        <Button
          disabled={workspaces.isFetching}
          onClick={() => setCursor(workspaces.data?.nextCursor ?? undefined)}
          type="button"
          variant="outline"
        >
          Load more
        </Button>
      ) : null}
      <Dialog
        onOpenChange={(open) => {
          if (!open && !transition.isPending) setPending(undefined);
        }}
        open={Boolean(pending)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm lifecycle change</DialogTitle>
            <DialogDescription>
              {pending?.to === "suspended" ? "Suspend" : "Reactivate"}{" "}
              {pending?.displayName ?? "this workspace"}?
            </DialogDescription>
          </DialogHeader>
          {transition.isError ? (
            <p className="type-supporting-body text-destructive" role="alert">
              Unable to update the workspace lifecycle.
            </p>
          ) : null}
          <DialogFooter showCloseButton>
            <Button
              disabled={!pending || transition.isPending}
              onClick={() =>
                pending &&
                transition.mutate({ workspaceId: pending.id, to: pending.to })
              }
              type="button"
              variant={pending?.to === "suspended" ? "destructive" : "default"}
            >
              {transition.isPending ? "Saving…" : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminShell>
  );
}

function LifecycleBadge({ state }: { readonly state: string }) {
  const variant =
    state === "active"
      ? "success"
      : state === "suspended"
        ? "warning"
        : state === "deleted"
          ? "destructive"
          : "secondary";
  return <Badge variant={variant}>{state}</Badge>;
}
