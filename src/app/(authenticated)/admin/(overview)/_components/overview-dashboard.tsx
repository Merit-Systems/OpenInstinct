"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

function total(values: Record<string, number>) {
  return Object.values(values).reduce((sum, value) => sum + value, 0);
}

export function OverviewDashboard() {
  const overview = api.admin.overview.useQuery();
  const sessionsActivity = api.admin.sessionsActivity.useQuery({ limit: 10 });
  const data = overview.data;

  const metrics = data
    ? [
        ["Workspaces", total(data.workspacesByLifecycle)],
        ["Agents", total(data.agentsByStatus)],
        ["Verified phone identities", data.verifiedPhoneIdentities],
        ["Active conversations", data.activeChannelConversations],
        ["Active API credentials", data.activeApiCredentials],
        ["Webhook endpoints", total(data.webhookEndpointsByStatus)],
      ]
    : [];

  return (
    <AdminShell
      description="Cross-workspace operational status and recent system activity."
      title="Admin overview"
    >
      {overview.isError ? (
        <p className="type-supporting-body text-destructive" role="alert">
          Unable to load overview.
        </p>
      ) : null}
      <section
        aria-label="System counts"
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
      >
        {metrics.map(([label, value]) => (
          <Card key={label} size="sm">
            <CardHeader>
              <CardTitle className="type-label text-muted-foreground">
                {label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="type-banner-metric">{String(value)}</p>
            </CardContent>
          </Card>
        ))}
      </section>
      {overview.isLoading ? (
        <p className="type-supporting-body text-muted-foreground">
          Loading overview…
        </p>
      ) : null}
      {data ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <SummaryCard entries={data.usageByKind} title="Usage this month" />
          <SummaryCard
            entries={data.webhookDeliveryOutcomes}
            title="Webhook delivery outcomes"
          />
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="type-section-title">
                Recent audit events
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.recentAudit.length === 0 ? (
                <p className="type-supporting-body text-muted-foreground">
                  No events yet.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {data.recentAudit.map((event) => (
                    <li
                      className="flex flex-wrap justify-between gap-x-4 gap-y-1 py-3"
                      key={event.id}
                    >
                      <span className="type-label">{event.action}</span>
                      <time
                        className="type-caption text-muted-foreground"
                        dateTime={event.createdAt}
                      >
                        {formatDate(event.createdAt)}
                      </time>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="type-section-title">
                Recent agent activity
              </CardTitle>
            </CardHeader>
            <CardContent>
              {sessionsActivity.isError ? (
                <p
                  className="type-supporting-body text-destructive"
                  role="alert"
                >
                  Unable to load recent agent activity.
                </p>
              ) : null}
              {sessionsActivity.data?.length === 0 ? (
                <p className="type-supporting-body text-muted-foreground">
                  No activity yet.
                </p>
              ) : null}
              {sessionsActivity.data && sessionsActivity.data.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Chat</TableHead>
                      <TableHead>Workspace</TableHead>
                      <TableHead>Updated</TableHead>
                      <TableHead>Tokens</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sessionsActivity.data.map((session) => (
                      <TableRow key={session.id}>
                        <TableCell className="type-compact-code">
                          {shortId(session.id)}
                        </TableCell>
                        <TableCell className="type-compact-code">
                          {shortId(session.workspaceId)}
                        </TableCell>
                        <TableCell className="type-caption text-muted-foreground">
                          <time dateTime={session.updatedAt}>
                            {formatDate(session.updatedAt)}
                          </time>
                        </TableCell>
                        <TableCell className="type-numeric type-label">
                          {String(session.inputTokens + session.outputTokens)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : null}
            </CardContent>
          </Card>
        </div>
      ) : null}
    </AdminShell>
  );
}

function SummaryCard({
  entries,
  title,
}: {
  readonly entries: Record<string, number>;
  readonly title: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="type-section-title">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {Object.keys(entries).length === 0 ? (
          <p className="type-supporting-body text-muted-foreground">
            No events yet.
          </p>
        ) : (
          <dl className="space-y-2">
            {Object.entries(entries).map(([key, value]) => (
              <div className="flex justify-between gap-4" key={key}>
                <dt className="type-supporting-body text-muted-foreground">
                  {key}
                </dt>
                <dd className="type-numeric type-label">{String(value)}</dd>
              </div>
            ))}
          </dl>
        )}
      </CardContent>
    </Card>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function shortId(value: string) {
  return value.length > 12 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value;
}
