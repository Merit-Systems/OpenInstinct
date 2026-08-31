import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { browserBenchmarkLiveStatusSchema } from "../../../../live-status-schema";
import { dashboardEnv } from "../../../env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const root = join(
    dashboardEnv.INIT_CWD ?? process.cwd(),
    ".eve",
    "browser-ab"
  );
  try {
    const entries = await readdir(/* turbopackIgnore: true */ root, {
      withFileTypes: true,
    });
    const paths = [
      dashboardEnv.BROWSER_BENCH_STATUS_PATH ?? join(root, "live.json"),
      ...entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => join(root, entry.name, "status.json")),
    ];
    const parsed = await Promise.all(paths.map(readStatus));
    const runs = new Map(
      parsed.flatMap((status) => (status ? [[status.runId, status]] : []))
    );
    return NextResponse.json({
      runs: [...runs.values()].toSorted((left, right) =>
        right.startedAt.localeCompare(left.startedAt)
      ),
    });
  } catch (error) {
    if (errorCode(error) === "ENOENT") return NextResponse.json({ runs: [] });
    console.error("Unable to list browser benchmark runs", error);
    return NextResponse.json(
      { error: "Unable to list benchmark runs." },
      { status: 500 }
    );
  }
}

async function readStatus(path: string) {
  try {
    return browserBenchmarkLiveStatusSchema.parse(
      JSON.parse(await readFile(/* turbopackIgnore: true */ path, "utf8"))
    );
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null;
    throw error;
  }
}

function errorCode(error: unknown) {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  return typeof error.code === "string" ? error.code : undefined;
}
