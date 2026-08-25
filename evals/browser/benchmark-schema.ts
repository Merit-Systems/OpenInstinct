import { z } from "zod";

const benchmarkTaskSchema = z.object({
  costComplete: z.boolean(),
  costUsd: z.number().nonnegative().nullable(),
  durationMs: z.number().nonnegative(),
  error: z.string().nullable(),
  evalDurationMs: z.number().nonnegative(),
  id: z.string(),
  name: z.string(),
  sessionId: z.string().nullable(),
  status: z.enum(["completed", "failed", "waiting"]),
  success: z.boolean(),
  terminalMessage: z.string(),
  verdict: z.enum(["passed", "failed", "scored", "skipped"]),
});

export const browserBenchmarkSchema = z.object({
  completedAt: z.iso.datetime(),
  gitSha: z.string().nullable(),
  label: z.string(),
  startedAt: z.iso.datetime(),
  summary: z.object({
    costComplete: z.boolean(),
    failed: z.number().int().nonnegative(),
    medianDurationMs: z.number().nonnegative().nullable(),
    passed: z.number().int().nonnegative(),
    p95DurationMs: z.number().nonnegative().nullable(),
    successRate: z.number().min(0).max(1),
    totalCostUsd: z.number().nonnegative().nullable(),
  }),
  target: z.object({
    kind: z.enum(["local", "remote"]),
    url: z.url(),
  }),
  tasks: z.array(benchmarkTaskSchema),
  version: z.literal(1),
});

export type BrowserBenchmark = z.infer<typeof browserBenchmarkSchema>;
