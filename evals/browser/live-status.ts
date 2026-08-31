import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  browserBenchmarkLiveStatusSchema,
  type BrowserBenchmarkLiveStatus,
} from "./live-status-schema.ts";

export type { BrowserBenchmarkLiveStatus } from "./live-status-schema.ts";

const writes = new Map<string, Promise<void>>();

export async function readBrowserBenchmarkLiveStatus(path: string) {
  try {
    return browserBenchmarkLiveStatusSchema.parse(
      JSON.parse(await readFile(path, "utf8"))
    );
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null;
    throw error;
  }
}

export async function writeBrowserBenchmarkLiveStatus(
  path: string,
  status: BrowserBenchmarkLiveStatus
) {
  const parsed = browserBenchmarkLiveStatusSchema.parse(status);
  const temporaryPath = `${path}.${String(process.pid)}.${randomUUID()}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    temporaryPath,
    `${JSON.stringify(parsed, null, 2)}\n`,
    "utf8"
  );
  await rename(temporaryPath, path);
}

export async function updateBrowserBenchmarkLiveStatus(
  path: string,
  runId: string,
  update: (status: BrowserBenchmarkLiveStatus) => BrowserBenchmarkLiveStatus
) {
  const previous = writes.get(path) ?? Promise.resolve();
  const next = previous.then(async () => {
    const current = await readBrowserBenchmarkLiveStatus(path);
    if (!current || current.runId !== runId) return undefined;
    await writeBrowserBenchmarkLiveStatus(path, {
      ...update(current),
      updatedAt: new Date().toISOString(),
    });
    return undefined;
  });
  writes.set(path, next);
  try {
    await next;
  } finally {
    if (writes.get(path) === next) writes.delete(path);
  }
}

function errorCode(error: unknown) {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  return typeof error.code === "string" ? error.code : undefined;
}
