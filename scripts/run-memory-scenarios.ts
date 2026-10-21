import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  memoryScenarios,
  memoryScenarioRepetitions,
} from "../evals/memory/scenarios.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
if (
  args.length !== 0 &&
  (args.length !== 2 || args[0] !== "--output" || !args[1])
) {
  throw new Error("Usage: run-memory-scenarios.ts [--output report.json]");
}
const destination = resolve(
  root,
  args[1] ?? ".eve/benchmarks/memory-scenarios.json"
);
const temporary = await mkdtemp(
  join(tmpdir(), "openinstinct-memory-scenarios-")
);
const rawReport = join(temporary, "vitest.json");
const reportSchema = z.object({
  testResults: z.array(
    z.object({
      assertionResults: z.array(
        z.object({
          fullName: z.string(),
          status: z.string(),
          duration: z.number().nullable().optional(),
        })
      ),
    })
  ),
});

try {
  const test = spawnSync(
    "pnpm",
    [
      "exec",
      "vitest",
      "run",
      "evals/memory/scenarios.test.ts",
      "--reporter=json",
      `--outputFile=${rawReport}`,
    ],
    { cwd: root, stdio: "inherit" }
  );
  if (test.error) throw test.error;
  const raw = reportSchema.parse(JSON.parse(await readFile(rawReport, "utf8")));
  const assertions = raw.testResults.flatMap(
    (result) => result.assertionResults
  );
  const scenarios = memoryScenarios.map(([id, title, baseline]) => ({
    id,
    title,
    evidenceGates: memoryScenarioRepetitions.map((repetition) => {
      const results = assertions.filter((result) =>
        result.fullName.includes(`repetition ${String(repetition)} ${id} `)
      );
      const result = results.length === 1 ? results[0] : undefined;
      return {
        repetition,
        status: result?.status ?? "missing",
        durationMs: result?.duration ?? null,
      };
    }),
    semanticQuality: {
      status: "not_measured",
      reason:
        "Fixture extraction does not measure model judgment, paraphrase quality, or answer grounding.",
    },
    baseline:
      baseline === "unsupported"
        ? {
            status: "unsupported",
            reason:
              "The pre-feature file-memory contract has no equivalent evidence/job/revision API.",
          }
        : {
            status: "not_run",
            reason:
              "Shared user-facing behavior requires the same live-model scenarios against the pinned baseline.",
          },
  }));
  const passed = scenarios
    .flatMap((scenario) => scenario.evidenceGates)
    .filter((result) => result.status === "passed").length;
  const revision = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  });
  const dirty = spawnSync("git", ["status", "--porcelain"], {
    cwd: root,
    encoding: "utf8",
  });
  const packages = z
    .object({ dependencies: z.object({ eve: z.string(), ai: z.string() }) })
    .parse(JSON.parse(await readFile(join(root, "package.json"), "utf8")));
  const report = {
    generatedAt: new Date().toISOString(),
    revision: revision.status === 0 ? revision.stdout.trim() : null,
    workingTreeDirty: dirty.status === 0 ? dirty.stdout.length > 0 : null,
    node: process.version,
    featureMode: "enabled",
    model: "fixture-extractor",
    packages: packages.dependencies,
    baselineRevision: "0c2a7c6e842fa7105cee004b2d6ac1d5f1c7c1e8",
    methodology:
      "Three isolated repetitions of forty deterministic evidence gates using production memory services and migrations in PGlite. Model output, Blob I/O, and recovery HTTP are fixture boundaries. No live semantic or hosted-storage result is implied.",
    totals: {
      scenarios: scenarios.length,
      executions: scenarios.length * memoryScenarioRepetitions.length,
      passed,
    },
    scenarios,
  };
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    `Memory evidence gates: ${String(passed)}/120 passed. Report: ${destination}`
  );
  if (test.status !== 0 || passed !== 120) process.exitCode = 1;
} finally {
  await rm(temporary, { recursive: true, force: true });
}
