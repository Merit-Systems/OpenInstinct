import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { env } from "../shared/environment/env";

const project = z
  .string()
  .regex(/^open-instinct-evals-[a-f0-9]{8}-[a-f0-9]{8}$/u)
  .parse(process.argv[2]);
const root = fileURLToPath(new URL("..", import.meta.url));
const address = execFileSync(
  "docker",
  ["compose", "--project-name", project, "port", "postgres", "5432"],
  {
    cwd: root,
    encoding: "utf8",
  }
).trim();
const port = /:(\d+)$/u.exec(address)?.[1];
if (
  !port ||
  env.DATABASE_URL !==
    `postgresql://postgres:postgres@127.0.0.1:${port}/open_instinct`
)
  throw new Error(
    "Cleanup requires the specified evaluation project's disposable local database."
  );

const { db } = await import("../db/index");
try {
  const { cleanupMemoryEvalArtifacts } =
    await import("../evals/memory/cleanup");
  await cleanupMemoryEvalArtifacts();
} finally {
  await db.$client.end();
}
