import { auth } from "@/auth";

function isFullyAuthenticatedUser(
  user:
    | {
        phoneNumber?: string | null;
        phoneNumberVerified?: boolean | null;
      }
    | null
    | undefined
) {
  return Boolean(user?.phoneNumber && user.phoneNumberVerified === true);
}
export async function getAuthSession(headers: Headers) {
  const session = await auth.api.getSession({ headers });
  if (!isFullyAuthenticatedUser(session?.user)) return null;
  return session;
}
