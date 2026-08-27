import { env } from "@/lib/env";

const LOCAL_EVE_ORIGIN = "http://127.0.0.1:4274";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const DELETE = forwardToEve;
export const GET = forwardToEve;
export const HEAD = forwardToEve;
export const OPTIONS = forwardToEve;
export const PATCH = forwardToEve;
export const POST = forwardToEve;
export const PUT = forwardToEve;

async function forwardToEve(
  request: Request,
  context: { readonly params: Promise<{ readonly path: readonly string[] }> }
) {
  const { path } = await context.params;
  const requestUrl = new URL(request.url);
  const targetUrl = new URL(
    `/eve/v1/${path.map(encodeURIComponent).join("/")}${requestUrl.search}`,
    env.EVE_NEXT_PRODUCTION_ORIGIN ?? LOCAL_EVE_ORIGIN
  );
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  headers.delete("host");

  try {
    const response = await fetch(targetUrl, {
      body:
        request.method === "GET" || request.method === "HEAD"
          ? undefined
          : await request.arrayBuffer(),
      headers,
      method: request.method,
      redirect: "manual",
      signal: request.signal,
    });
    const responseHeaders = new Headers(response.headers);
    responseHeaders.delete("content-length");

    return new Response(response.body, {
      headers: responseHeaders,
      status: response.status,
      statusText: response.statusText,
    });
  } catch (error) {
    console.error("Unable to reach the Eve runtime", error);
    return Response.json(
      {
        error: "The agent runtime is unavailable. Try again in a moment.",
        ok: false,
      },
      { status: 502 }
    );
  }
}
