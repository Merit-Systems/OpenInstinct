import { z } from "zod";

const browserRunTaskSchema = z.object({
  completedAt: z.number().nonnegative().optional(),
  costComplete: z.boolean(),
  costUsd: z.number().nonnegative().nullable(),
  durationMs: z.number().nonnegative(),
  id: z.string(),
  prompt: z.string().min(1),
  sessionId: z.string().optional(),
  startedAt: z.number().nonnegative().optional(),
  status: z.enum(["queued", "running", "success", "failure"]),
  terminalMessage: z.string().optional(),
});

const browserRunGroupSchema = z.object({
  concurrency: z.number().int().min(1).max(8),
  createdAt: z.string(),
  id: z.string(),
  name: z.string().min(1),
  tasks: z.array(browserRunTaskSchema),
  updatedAt: z.string(),
});

const browserRunStoreSchema = z.object({
  groups: z.array(browserRunGroupSchema),
  version: z.literal(1),
});

export type BrowserRunGroup = z.infer<typeof browserRunGroupSchema>;
export type BrowserRunTask = z.infer<typeof browserRunTaskSchema>;
export type BrowserRunTaskUpdate = Partial<
  Omit<BrowserRunTask, "id" | "prompt">
>;

export const browserRunStoreEvent = "eve-browser-runs-changed";

const browserRunStoreKey = "eve-kernel:browser-runs:v1";

export function readBrowserRunGroups() {
  const serialized = window.localStorage.getItem(browserRunStoreKey);
  if (!serialized) return [];

  try {
    const parsed = browserRunStoreSchema.safeParse(JSON.parse(serialized));
    return parsed.success ? parsed.data.groups : [];
  } catch {
    return [];
  }
}

export function createBrowserRunGroup({
  concurrency,
  name,
  prompts,
}: {
  readonly concurrency: number;
  readonly name: string;
  readonly prompts: readonly string[];
}): BrowserRunGroup {
  const now = new Date().toISOString();

  return {
    concurrency,
    createdAt: now,
    id: crypto.randomUUID(),
    name: name.trim(),
    tasks: prompts.map((prompt) => ({
      costComplete: false,
      costUsd: null,
      durationMs: 0,
      id: crypto.randomUUID(),
      prompt,
      status: "queued",
    })),
    updatedAt: now,
  };
}

export function saveBrowserRunGroup(group: BrowserRunGroup) {
  const groups = readBrowserRunGroups();
  const existingIndex = groups.findIndex(
    (candidate) => candidate.id === group.id
  );
  const nextGroups = [...groups];

  if (existingIndex === -1) {
    nextGroups.unshift(group);
  } else {
    nextGroups[existingIndex] = group;
  }

  writeBrowserRunGroups(nextGroups);
}

export function updateBrowserRunTask(
  groupId: string,
  taskId: string,
  update: BrowserRunTaskUpdate
) {
  const groups = readBrowserRunGroups();
  const groupIndex = groups.findIndex((group) => group.id === groupId);
  if (groupIndex === -1) return;

  const group = groups[groupIndex];
  if (!group) return;
  const taskIndex = group.tasks.findIndex((task) => task.id === taskId);
  if (taskIndex === -1) return;
  const task = group.tasks[taskIndex];
  if (!task) return;

  const updatedAt = new Date().toISOString();
  const tasks = [...group.tasks];
  tasks[taskIndex] = { ...task, ...update };
  const nextGroups = [...groups];
  nextGroups[groupIndex] = { ...group, tasks, updatedAt };
  writeBrowserRunGroups(nextGroups);
}

function writeBrowserRunGroups(groups: readonly BrowserRunGroup[]) {
  window.localStorage.setItem(
    browserRunStoreKey,
    JSON.stringify({ groups, version: 1 })
  );
  window.dispatchEvent(new Event(browserRunStoreEvent));
}
