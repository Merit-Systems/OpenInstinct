"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

export function AuditLogTable() {
  const [workspaceId, setWorkspaceId] = useState("");
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<
    string | undefined
  >();
  const [cursor, setCursor] = useState<string | undefined>();
  const auditLog = api.admin.auditLog.useQuery({
    cursor,
    limit: 100,
    workspaceId: activeWorkspaceId,
  });

  function applyFilter() {
    setCursor(undefined);
    setActiveWorkspaceId(workspaceId.trim() || undefined);
  }

  return (
    <AdminShell
      description="Append-only operational audit events across all workspaces."
      title="Audit log"
    >
      <form
        className="flex max-w-lg gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          applyFilter();
        }}
      >
        <Input
          aria-label="Workspace ID"
          onChange={(event) => {
            setWorkspaceId(event.target.value);
          }}
          placeholder="Filter by workspace ID"
          value={workspaceId}
        />
        <Button type="submit" variant="outline">
          Filter
        </Button>
      </form>
      {auditLog.isError ? (
        <p className="type-supporting-body text-destructive" role="alert">
          Unable to load audit events.
        </p>
      ) : null}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>When</TableHead>
            <TableHead>Action</TableHead>
            <TableHead>Workspace</TableHead>
            <TableHead>Outcome</TableHead>
            <TableHead>Target</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {auditLog.data?.events.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} variant="empty">
                No events yet.
              </TableCell>
            </TableRow>
          ) : null}
          {auditLog.data?.events.map((event) => (
            <TableRow key={event.id}>
              <TableCell>
                <time dateTime={event.createdAt}>
                  {formatDate(event.createdAt)}
                </time>
              </TableCell>
              <TableCell className="type-label">{event.action}</TableCell>
              <TableCell variant="code">{event.workspaceId}</TableCell>
              <TableCell>{event.outcome}</TableCell>
              <TableCell variant="code">{event.target ?? "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {auditLog.data?.nextCursor ? (
        <Button
          disabled={auditLog.isFetching}
          onClick={() => {
            setCursor(auditLog.data.nextCursor ?? undefined);
          }}
          type="button"
          variant="outline"
        >
          Load older events
        </Button>
      ) : null}
    </AdminShell>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
