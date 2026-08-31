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

export const authSessionDependencies = {
  async getSession(headers: Headers) {
    const auth = await getAuth();
    return auth.api.getSession({ headers });
  },
};

export async function getAuthSession(headers: Headers) {
  const session = await authSessionDependencies.getSession(headers);
  const parsed = authenticatedSessionSchema.safeParse(session);
  return parsed.success ? parsed.data : null;
}
