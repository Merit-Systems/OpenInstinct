"use client";

import { MessageSquareIcon, PlayIcon, RotateCcwIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { GlobalTaskHistory } from "@/app/_components/global-task-history";
import { useBrowserRunGroups } from "@/app/_components/use-browser-run-groups";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { browserBenchmarkTasks } from "@/lib/browser-benchmark-tasks";
import {
  createBrowserRunGroup,
  saveBrowserRunGroup,
} from "@/lib/browser-run-store";

const starterTasks = browserBenchmarkTasks
  .map((task) => task.prompt)
  .join("\n");

export function BrowserBatchRunner() {
  const router = useRouter();
  const { groups } = useBrowserRunGroups();
  const [input, setInput] = useState(starterTasks);
  const [groupName, setGroupName] = useState("");
  const [concurrency, setConcurrency] = useState(4);
  const parsedTasks = useMemo(() => parseTasks(input), [input]);

  const handleSubmit = () => {
    if (parsedTasks.length === 0) return;

    const group = createBrowserRunGroup({
      concurrency,
      name: groupName.trim() || defaultGroupName(),
      prompts: parsedTasks,
    });
    saveBrowserRunGroup(group);
    router.push(`/runs/${group.id}`);
  };

  return (
    <main className="flex flex-col gap-12">
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
        <div className="flex flex-col gap-4 border-y border-border py-6">
          <div className="grid gap-2 sm:max-w-md">
            <Label htmlFor="group-name">Group name</Label>
            <Input
              id="group-name"
              onChange={(event) => setGroupName(event.target.value)}
              placeholder="Spider-Man tickets regression"
              value={groupName}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="batch-tasks">Task list</Label>
            <Textarea
              className="min-h-48 resize-y"
              id="batch-tasks"
              onChange={(event) => setInput(event.target.value)}
              placeholder="Get me tickets to Spider-Man tonight…"
              value={input}
            />
            <p className="type-caption text-muted-foreground">
              {parsedTasks.length === 1
                ? "1 task ready"
                : `${String(parsedTasks.length)} tasks ready`}
            </p>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div className="grid gap-2">
              <Label htmlFor="batch-concurrency">Concurrency</Label>
              <Select
                onValueChange={(value) => setConcurrency(Number(value))}
                value={String(concurrency)}
              >
                <SelectTrigger id="batch-concurrency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[1, 2, 4, 8].map((value) => (
                    <SelectItem key={value} value={String(value)}>
                      {String(value)} at once
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button
              disabled={parsedTasks.length === 0}
              onClick={handleSubmit}
              type="button"
            >
              <PlayIcon />
              Create and run group
            </Button>

            <Button
              onClick={() => setInput(starterTasks)}
              type="button"
              variant="ghost"
            >
              <RotateCcwIcon />
              Load examples
            </Button>
          </div>
        </div>
      </section>

      <GlobalTaskHistory localGroups={groups} />
    </main>
  );
}

const groupNameFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

function defaultGroupName() {
  return `Run ${groupNameFormatter.format(new Date())}`;
}

function parseTasks(input: string) {
  return input
    .split("\n")
    .map((task) => task.trim())
    .filter((task) => task.length > 0);
}
