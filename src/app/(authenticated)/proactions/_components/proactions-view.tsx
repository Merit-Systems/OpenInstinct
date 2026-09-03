"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import type { ProactionOverview } from "@/agent/lib/proactions/overview";
import { api } from "@/trpc/client";
import { BriefSettingsForm } from "./brief-settings-form";
import { FindingsInbox } from "./findings-inbox";
import { ProactionRow } from "./proaction-row";

export function ProactionsView({
  initialOverview,
}: {
  readonly initialOverview: ProactionOverview;
}) {
  const router = useRouter();
  const overview = api.proactions.overview.useQuery(undefined, {
    initialData: initialOverview,
  });
  const refresh = () => {
    void overview.refetch();
    router.refresh();
  };
  const data = overview.data;

  return (
    <div className="mx-auto flex w-full max-w-4xl min-w-0 flex-col gap-8 px-4 py-6 sm:px-6 sm:py-8">
      <div className="space-y-2">
        <h1 className="type-page-title">Proactions</h1>
        <p className="type-body max-w-2xl text-muted-foreground">
          Things your agent watches for on its own. Each one switches itself on
          once what it needs is connected, and only speaks up when there is
          something worth knowing.
        </p>
      </div>

      <Section headingId="proactions-heading" title="Behaviors">
        <div className="divide-y divide-border/50 border-y border-border/50">
          {data.proactions.map((proaction) => (
            <ProactionRow
              key={proaction.id}
              onChanged={refresh}
              proaction={proaction}
            />
          ))}
        </div>
      </Section>

      <Section headingId="brief-heading" title="Brief time">
        <p className="type-caption text-muted-foreground">
          Daily and weekly proactions run and deliver at this local time.{" "}
          {data.settings.deliveryChannel === "imessage"
            ? "Findings are sent to your iMessage thread."
            : "Findings stay in the inbox below until you message the agent on iMessage."}
        </p>
        <BriefSettingsForm onSaved={refresh} settings={data.settings} />
      </Section>

      <Section headingId="inbox-heading" title="Inbox">
        <FindingsInbox
          findings={data.findings}
          onChanged={refresh}
          proactions={data.proactions}
        />
      </Section>
    </div>
  );
}

function Section({
  children,
  headingId,
  title,
}: {
  readonly children: ReactNode;
  readonly headingId: string;
  readonly title: string;
}) {
  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <h2 className="type-section-title" id={headingId}>
        {title}
      </h2>
      {children}
    </section>
  );
}
