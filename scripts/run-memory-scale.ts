/* oxlint-disable eslint/no-await-in-loop -- Independent benchmark processes run sequentially to avoid measurement contention. */
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const output = resolve(process.argv[2] ?? join(root, ".eve/memory-scale"));
await mkdir(output, { recursive: true });
const reports: string[] = [];

for (const run of [1, 2, 3]) {
  const child = spawn(
    join(root, "node_modules/.bin/vitest"),
    ["run", "--config", "evals/memory/scale/vitest.config.ts"],
    {
      cwd: root,
      /* oxlint-disable eslint/no-restricted-properties, turbo/no-undeclared-env-vars -- Isolated benchmark bootstrap passes host paths and validated report settings, never service credentials. */
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        TMPDIR: process.env.TMPDIR,
        NODE_ENV: "test",
        MEMORY_SCALE_OUTPUT: output,
        MEMORY_SCALE_RUN: String(run),
      },
      /* oxlint-enable eslint/no-restricted-properties, turbo/no-undeclared-env-vars */
      stdio: "inherit",
    }
  );
  const code = await new Promise<number | null>((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", resolveExit);
  });
  if (code !== 0) throw new Error(`Memory scale run ${String(run)} failed.`);
  reports.push(await readFile(join(output, `run-${String(run)}.md`), "utf8"));
}

await writeFile(join(output, "report.md"), reports.join("\n\n---\n\n"));
console.log(`Memory scale reports: ${output}`);
