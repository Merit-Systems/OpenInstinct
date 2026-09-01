"use client";

import { PlayIcon, RotateCcwIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
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
import {
  createBrowserRunGroup,
  saveBrowserRunGroup,
} from "@/app/(authenticated)/_lib/browser-run-store";
import { browserBenchmarkTasks } from "@/lib/browser/benchmark-tasks";

const starterTasks = browserBenchmarkTasks
  .map((task) => task.prompt)
  .join("\n");

export function BrowserBatchForm() {
  const router = useRouter();
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
