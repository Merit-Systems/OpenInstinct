"use client";

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

export function UsageTable() {
  const usage = api.admin.usage.useQuery({});
  return (
    <AdminShell
      description="Usage aggregates by workspace and recorded usage kind. Top 50 by volume."
      title="Usage"
    >
      {usage.isError ? (
        <p className="type-supporting-body text-destructive" role="alert">
          Unable to load usage data.
        </p>
      ) : null}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Workspace</TableHead>
            <TableHead>Kind</TableHead>
            <TableHead>Quantity</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {usage.data?.length === 0 ? (
            <TableRow>
              <TableCell colSpan={3} variant="empty">
                No usage events yet.
              </TableCell>
            </TableRow>
          ) : null}
          {usage.data?.map((item) => (
            <TableRow key={`${item.workspaceId}:${item.kind}`}>
              <TableCell variant="code">{item.workspaceId}</TableCell>
              <TableCell>{item.kind}</TableCell>
              <TableCell className="type-numeric">
                {String(item.quantity)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </AdminShell>
  );
}
