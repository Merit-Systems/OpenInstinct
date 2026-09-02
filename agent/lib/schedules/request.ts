import { getVercelOidcToken } from "@vercel/oidc";
import { env } from "@/env";
import { applicationOrigin } from "@/lib/application-origin";

interface ScheduledRunRequestBodies {
  "/internal/scheduled-run/report": { runId: string };
  "/internal/scheduled-run/respond": {
    answer: string;
    leaseToken: string;
    runId: string;
  };
  "/internal/scheduled-run/start": {
    leaseToken: string;
    restart: boolean;
    runId: string;
  };
}

export async function postScheduledRunRoute<
  Route extends keyof ScheduledRunRequestBodies,
>(route: Route, body: ScheduledRunRequestBodies[Route]) {
  const token = env.VERCEL_ENV ? await getVercelOidcToken() : undefined;
  const headers = new Headers({ "content-type": "application/json" });
  if (token) {
    headers.set("authorization", `Bearer ${token}`);
    headers.set("x-vercel-trusted-oidc-idp-token", token);
  }
  const origin =
    env.VERCEL_ENV && env.VERCEL_URL
      ? `https://${env.VERCEL_URL}`
      : applicationOrigin();
  return fetch(new URL(route, origin), {
    body: JSON.stringify(body),
    headers,
    method: "POST",
    redirect: "error",
  });
}

export async function postScheduledReport(runId: string) {
  const response = await postScheduledRunRoute(
    "/internal/scheduled-run/report",
    { runId }
  );
  if (!response.ok) {
    throw new Error(
      `Scheduled report callback failed (${String(response.status)}).`
    );
  }
}
