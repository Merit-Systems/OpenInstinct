import { z } from "zod";
import { getAuth } from "@/auth";

const authenticatedSessionSchema = z
  .object({
    user: z
      .object({
        id: z.string().min(1),
        phoneNumber: z.string().min(1),
        phoneNumberVerified: z.literal(true),
      })
      .loose(),
  })
  .loose();

const authSessionCandidateSchema = z
  .object({
    user: z
      .object({
        id: z.string().optional(),
        phoneNumber: z.string().nullable().optional(),
        phoneNumberVerified: z.boolean().nullable().optional(),
      })
      .loose()
      .optional(),
  })
  .loose();

export type AuthSessionCandidate = z.infer<typeof authSessionCandidateSchema>;

export const authSessionDependencies = {
  async getSession(headers: Headers): Promise<AuthSessionCandidate | null> {
    const auth = await getAuth();
    return authSessionCandidateSchema
      .nullable()
      .parse(await auth.api.getSession({ headers }));
  },
};

export function createGetAuthSession(
  dependencies: Pick<
    typeof authSessionDependencies,
    "getSession"
  > = authSessionDependencies
) {
  return async function getAuthSession(headers: Headers) {
    const session = await dependencies.getSession(headers);
    const parsed = authenticatedSessionSchema.safeParse(session);
    return parsed.success ? parsed.data : null;
  };
}

const readAuthSession = createGetAuthSession();

export async function getAuthSession(headers: Headers) {
  return readAuthSession(headers);
}
