import { eq } from "drizzle-orm";
import { normalizeAuthPhoneNumber } from "@/auth/phone-number";
import { db, user } from "@/db";
import { env } from "@/env";
import { requireRequestScope } from "@/lib/request-scope";
import type { AccessScope } from "./access-scope";

export const adminDependencies = {
  adminPhoneNumbers: () => env.ADMIN_PHONE_NUMBERS,
};

/** A deliberately opaque error: admin routes should look absent to non-admins. */
export class AdminNotFoundError extends Error {
  constructor() {
    super("Not found.");
    this.name = "AdminNotFoundError";
  }
}

export function parseAdminPhoneNumbers(value: string | undefined) {
  return new Set(
    (value ?? "")
      .split(",")
      .map((phoneNumber) => normalizeAuthPhoneNumber(phoneNumber))
      .filter((phoneNumber): phoneNumber is string => phoneNumber !== undefined)
  );
}

function isAdminPhoneNumber(phoneNumber: string | null | undefined) {
  const normalized =
    phoneNumber === null || phoneNumber === undefined
      ? undefined
      : normalizeAuthPhoneNumber(phoneNumber);
  return (
    normalized !== undefined &&
    parseAdminPhoneNumbers(adminDependencies.adminPhoneNumbers()).has(
      normalized
    )
  );
}

function betterAuthUserId(scopeUserId: string) {
  const prefix = "better-auth:";
  if (!scopeUserId.startsWith(prefix)) throw new AdminNotFoundError();
  return scopeUserId.slice(prefix.length);
}

export async function requireAdminScopeFor(scope: AccessScope) {
  const [account] = await db
    .select({ phoneNumber: user.phoneNumber })
    .from(user)
    .where(eq(user.id, betterAuthUserId(scope.userId)))
    .limit(1);
  if (!isAdminPhoneNumber(account?.phoneNumber)) throw new AdminNotFoundError();
  return scope;
}

export async function requireAdminScope() {
  return requireAdminScopeFor(await requireRequestScope());
}

/** Server-component friendly visibility check; it never leaks a phone number. */
export async function isAdmin() {
  try {
    await requireAdminScope();
    return true;
  } catch (error) {
    if (error instanceof AdminNotFoundError) return false;
    throw error;
  }
}
