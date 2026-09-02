import { getVercelOidcToken } from "@vercel/oidc";
import { env } from "@/env";
import { applicationOrigin } from "@/lib/application-origin";

export async function postScheduledReport(runId: string) {
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
  const response = await fetch(
    new URL("/internal/scheduled-run/report", origin),
    {
      body: JSON.stringify({ runId }),
      headers,
      method: "POST",
      redirect: "error",
    }
  );
  if (!response.ok) {
    throw new Error(
      `Scheduled report callback failed (${String(response.status)}).`
    );
  }
}
