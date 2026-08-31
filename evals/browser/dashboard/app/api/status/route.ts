import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { dashboardEnv } from "../../../env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const path =
      dashboardEnv.BROWSER_BENCH_STATUS_PATH ??
      join(
        dashboardEnv.INIT_CWD ?? process.cwd(),
        ".eve",
        "browser-ab",
        "live.json"
      );
    return new NextResponse(
      await readFile(/* turbopackIgnore: true */ path, "utf8"),
      {
        headers: { "Content-Type": "application/json; charset=utf-8" },
      }
    );
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      return new NextResponse(null, { status: 204 });
    }
    console.error("Unable to read browser benchmark status", error);
    return NextResponse.json(
      { error: "Unable to read live benchmark status." },
      { status: 500 }
    );
  }
}

function errorCode(error: unknown) {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  return typeof error.code === "string" ? error.code : undefined;
}
