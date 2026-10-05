import { getVercelOidcToken } from "@vercel/oidc";
import type {
  ScheduledCommand,
  ScheduledWakeup,
} from "@shared/schedules/wakeups";
import {
  scheduledApplicationOrigin,
  scheduledRunOrigin,
} from "@shared/environment/scheduled-origin";
import { createHmac, timingSafeEqual } from "node:crypto";
import { routeAuth, vercelOidc } from "eve/channels/auth";
import { getInstallationSecrets } from "../installation-secrets";
import { env } from "@shared/environment";

async function signature(path: string, timestamp: string, body: string) {
  const { betterAuthSecret } = await getInstallationSecrets();
  return createHmac("sha256", betterAuthSecret)
    .update(["scheduled-wakeup:v1", path, timestamp, body].join("\n"))
    .digest("hex");
}

export async function signScheduledRequest(path: string, body: string) {
  const timestamp = String(Date.now());
  return {
    "x-openinstinct-schedule-time": timestamp,
    "x-openinstinct-schedule-signature": await signature(path, timestamp, body),
  };
}

export async function authorizeScheduledRequest(request: Request) {
  if (env.VERCEL_ENV) {
    const auth = await routeAuth(request, [vercelOidc()]);
    if (auth instanceof Response) return auth;
    return auth.principalType === "runtime"
      ? undefined
      : new Response(null, { status: 403 });
  }
  const denied = new Response(null, {
    status: 401,
    headers: { "www-authenticate": "Bearer" },
  });
  const timestamp = request.headers.get("x-openinstinct-schedule-time");
  const received = request.headers.get("x-openinstinct-schedule-signature");
  if (
    !timestamp ||
    !received ||
    !/^\d+$/u.test(timestamp) ||
    !/^[a-f0-9]{64}$/u.test(received) ||
    Math.abs(Date.now() - Number(timestamp)) > 5 * 60_000
  )
    return denied;
  const expected = await signature(
    new URL(request.url).pathname,
    timestamp,
    await request.clone().text()
  );
  return timingSafeEqual(
    Buffer.from(received, "hex"),
    Buffer.from(expected, "hex")
  )
    ? undefined
    : denied;
}

interface ScheduledRunRequestBodies {
  "/api/scheduled-wakeups": ScheduledCommand;
  "/internal/scheduled-run/command": ScheduledCommand;
  "/internal/scheduled-run/wake": ScheduledWakeup;
  "/internal/scheduled-run/report": { runId: string };
  "/internal/scheduled-run/respond": {
    answer: string;
    leaseToken: string;
    runId: string;
  };
}

export async function postScheduledRunRoute<
  Route extends keyof ScheduledRunRequestBodies,
>(route: Route, body: ScheduledRunRequestBodies[Route], targetOrigin?: string) {
  const token = env.VERCEL_ENV ? await getVercelOidcToken() : undefined;
  const headers = new Headers({ "content-type": "application/json" });
  if (token) {
    headers.set("authorization", `Bearer ${token}`);
    headers.set("x-vercel-trusted-oidc-idp-token", token);
  }
  if (
    !env.VERCEL_ENV &&
    (route === "/api/scheduled-wakeups" ||
      route === "/internal/scheduled-run/command" ||
      route === "/internal/scheduled-run/wake")
  ) {
    for (const [name, value] of Object.entries(
      await signScheduledRequest(route, JSON.stringify(body))
    ))
      headers.set(name, value);
  }
  const origin =
    targetOrigin ??
    (route === "/api/scheduled-wakeups"
      ? scheduledApplicationOrigin()
      : await scheduledRunOrigin());
  return fetch(new URL(route, origin), {
    body: JSON.stringify(body),
    headers,
    method: "POST",
    redirect: "error",
  });
}
