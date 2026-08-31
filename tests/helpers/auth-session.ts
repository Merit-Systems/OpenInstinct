import type { auth } from "@/auth";

type BetterAuthSession = NonNullable<
  Awaited<ReturnType<typeof auth.api.getSession>>
>;

export function authSessionFor(
  user: Pick<BetterAuthSession["user"], "id"> &
    Partial<BetterAuthSession["user"]>
): BetterAuthSession {
  const now = new Date("2026-08-31T00:00:00.000Z");
  return {
    session: {
      createdAt: now,
      expiresAt: new Date("2026-09-01T00:00:00.000Z"),
      id: `session-${user.id}`,
      token: `token-${user.id}`,
      updatedAt: now,
      userId: user.id,
    },
    user: {
      createdAt: now,
      email: `${user.id}@example.com`,
      emailVerified: true,
      name: user.id,
      updatedAt: now,
      ...user,
    },
  };
}
