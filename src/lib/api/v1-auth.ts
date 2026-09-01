import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { apiIdempotencyKeys, db } from "@/db";
import type { ApiCredentialScope } from "@/db";
import { authenticateApiKey } from "@/db/services/api-credentials";
import {
  assertWorkspaceOperable,
  verifyScopeAccess,
} from "@/db/services/scope";
import { isWorkspaceScopeEnforcementEnabled } from "@/env";

interface ApiRequestContext {
  readonly scope: { readonly userId: string; readonly workspaceId: string };
  readonly requestId: string;
}

export async function authorizeApiRequest(
  request: Request,
  requiredScope: ApiCredentialScope
) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  const match = /^Bearer (.+)$/i.exec(
    request.headers.get("authorization") ?? ""
  );
  if (!match?.[1])
    return {
      response: apiError(
        401,
        "unauthorized",
        "Authentication is required.",
        requestId
      ),
    };
  const credential = await authenticateApiKey(match[1]);
  if (!credential)
    return {
      response: apiError(
        401,
        "unauthorized",
        "Authentication is required.",
        requestId
      ),
    };
  if (!credential.scopes.includes(requiredScope))
    return {
      response: apiError(
        403,
        "forbidden",
        "This API credential does not have the required scope.",
        requestId
      ),
    };

  // API calls execute as the user who minted the credential so downstream
  // membership predicates remain valid; never use an API credential ID as userId.
  const scope = {
    userId: credential.createdByUserId,
    workspaceId: credential.workspaceId,
  };
  if (isWorkspaceScopeEnforcementEnabled()) {
    if (!(await verifyScopeAccess(scope)))
      return {
        response: apiError(
          401,
          "unauthorized",
          "Authentication is required.",
          requestId
        ),
      };
    try {
      await assertWorkspaceOperable(scope);
    } catch {
      return {
        response: apiError(
          401,
          "unauthorized",
          "Authentication is required.",
          requestId
        ),
      };
    }
  }
  return { context: { scope, requestId } satisfies ApiRequestContext };
}

export function apiJson(
  body: z.output<z.ZodType>,
  status: number,
  requestId: string
) {
  return Response.json(body, {
    status,
    headers: { "x-request-id": requestId },
  });
}

export function apiError(
  status: number,
  code: string,
  message: string,
  requestId: string
) {
  return apiJson({ error: { code, message } }, status, requestId);
}

type JsonParseResult<T> = { readonly data: T } | { readonly error: string };
type RequiredIdempotencyKeyResult =
  | { readonly key: string }
  | { readonly response: Response };

export async function parseJson<T>(
  request: Request,
  schema: z.ZodType<T>
): Promise<JsonParseResult<T>> {
  try {
    return { data: schema.parse(await request.json()) };
  } catch {
    return { error: "Request body is invalid." };
  }
}

export function requiredIdempotencyKey(
  request: Request,
  requestId: string
): RequiredIdempotencyKeyResult {
  const key = request.headers.get("idempotency-key")?.trim();
  return key
    ? { key }
    : {
        response: apiError(
          400,
          "idempotency_key_required",
          "An Idempotency-Key header is required.",
          requestId
        ),
      };
}

async function findIdempotencyKey(
  workspaceId: string,
  route: string,
  key: string
) {
  const [row] = await db
    .select()
    .from(apiIdempotencyKeys)
    .where(
      and(
        eq(apiIdempotencyKeys.workspaceId, workspaceId),
        eq(apiIdempotencyKeys.route, route),
        eq(apiIdempotencyKeys.idempotencyKey, key)
      )
    )
    .limit(1);
  return row;
}

export async function reserveIdempotencyKey(
  workspaceId: string,
  route: string,
  key: string
) {
  const inserted = await db
    .insert(apiIdempotencyKeys)
    .values({
      id: randomUUID(),
      workspaceId,
      route,
      idempotencyKey: key,
      responseStatus: 201,
      createdAt: new Date().toISOString(),
    })
    .onConflictDoNothing()
    .returning({ id: apiIdempotencyKeys.id });
  if (inserted.length > 0) return { state: "reserved" } as const;
  const existing = await findIdempotencyKey(workspaceId, route, key);
  return existing?.resourceId
    ? ({ state: "complete", row: existing } as const)
    : ({ state: "in_flight" } as const);
}

// Reserve before a controlled-service write. The reservation prevents concurrent
// callers from creating duplicate resources; a failed write releases it for retry.
export async function finalizeIdempotencyKey(
  workspaceId: string,
  route: string,
  key: string,
  resourceId: string,
  responseStatus: number
) {
  await db
    .update(apiIdempotencyKeys)
    .set({ resourceId, responseStatus })
    .where(
      and(
        eq(apiIdempotencyKeys.workspaceId, workspaceId),
        eq(apiIdempotencyKeys.route, route),
        eq(apiIdempotencyKeys.idempotencyKey, key),
        isNull(apiIdempotencyKeys.resourceId)
      )
    );
}

export async function releaseIdempotencyReservation(
  workspaceId: string,
  route: string,
  key: string
) {
  await db
    .delete(apiIdempotencyKeys)
    .where(
      and(
        eq(apiIdempotencyKeys.workspaceId, workspaceId),
        eq(apiIdempotencyKeys.route, route),
        eq(apiIdempotencyKeys.idempotencyKey, key),
        isNull(apiIdempotencyKeys.resourceId)
      )
    );
}

export function apiErrorFor(error: Error | z.ZodError, requestId: string) {
  if (error instanceof z.ZodError)
    return apiError(
      400,
      "invalid_request",
      "Request body is invalid.",
      requestId
    );
  const message = errorMessage(error);
  if (
    message === "Agent not found." ||
    message === "Revision does not belong to this agent."
  )
    return apiError(404, "not_found", "Resource not found.", requestId);
  if (message === "Agent is archived.")
    return apiError(409, "conflict", "Agent is archived.", requestId);
  if (
    message.includes("duplicate key") ||
    message.includes("unique constraint") ||
    message.includes("agents_workspace_slug_uidx")
  )
    return apiError(
      409,
      "conflict",
      "A resource with this value already exists.",
      requestId
    );
  return apiError(
    500,
    "internal_error",
    "An internal error occurred.",
    requestId
  );
}

function errorMessage(error: Error): string {
  const cause = error.cause;
  return cause instanceof Error
    ? `${error.message} ${errorMessage(cause)}`
    : error.message;
}
