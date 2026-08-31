import { MessageSquareIcon } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { readTaskHistoryPage } from "@/trpc/router";
import { requireRequestScope } from "@/lib/request-scope";
import { BrowserBatchForm } from "./_components/browser-batch-form";
import { GlobalTaskHistory } from "./_components/global-task-history";

export default async function TasksPage() {
  const scope = await requireRequestScope();
  let initialError: string | undefined;
  let initialHistory;
  try {
    initialHistory = await readTaskHistoryPage(scope);
  } catch (error) {
    console.error("Unable to read initial task history", error);
    initialError = "Unable to read the durable task history.";
  }
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-12 px-4 py-6 sm:py-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="max-w-2xl">
          <h1 className="type-page-title">Browser jobs</h1>
          <p className="type-supporting-body mt-2 text-muted-foreground">
            Create recoverable task groups and monitor every browser job from
            one persistent dashboard.
          </p>
        </div>
        <Button
          nativeButton={false}
          render={<Link href="/chat" />}
          variant="outline"
        >
          Open chat
          <MessageSquareIcon data-icon="inline-end" />
        </Button>
      </header>

      <section aria-labelledby="new-group-heading" className="space-y-3">
        <div className="space-y-1">
          <h2 className="type-section-title" id="new-group-heading">
            New group
          </h2>
          <p className="type-supporting-body text-muted-foreground">
            Enter one browser task per line. Submitting saves the group and
            opens its live run page.
          </p>
        </div>
        <BrowserBatchForm />
      </section>

      <section aria-labelledby="all-tasks-heading" className="grid gap-4">
        <div>
          <h2 className="type-card-title" id="all-tasks-heading">
            Every task ever run
          </h2>
          <p className="type-supporting-body mt-1 text-muted-foreground">
            Durable project-wide history across browsers and sessions. Load
            older pages to walk the complete run ledger.
          </p>
        </div>
        <GlobalTaskHistory
          initialError={initialError}
          initialPage={initialHistory}
        />
      </section>
    </div>
  );
}
