import { auth, ensureAuthDatabase } from "@/auth";
import { isFullyAuthenticatedUser } from "@/lib/auth-user";

export async function getAuthSession(headers: Headers) {
  await ensureAuthDatabase();
  const session = await auth.api.getSession({ headers });
  if (!isFullyAuthenticatedUser(session?.user)) return null;
  return session;
}
