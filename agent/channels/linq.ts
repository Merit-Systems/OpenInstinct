/* oxlint-disable typescript/no-unsafe-member-access -- Eve's Linq adapter exposes messages through a transitive Chat SDK type that Oxlint resolves as an error type. */
import { connectLinqCredentials } from "@vercel/connect/eve";
import { defaultLinqAuth, linqChannel } from "eve/channels/linq";
import { z } from "zod";
import { auth } from "@/auth";
import { normalizeAuthPhoneNumber } from "@/auth/phone-number";
import { accessScopeForUser } from "@/lib/access-scope";
import { env } from "@/lib/env";

const verifiedPhoneUserSchema = z.object({
  id: z.string().min(1),
  phoneNumberVerified: z.literal(true),
});

export default linqChannel({
  credentials: connectLinqCredentials(env.LINQ_CONNECTOR_UID),
  async onMessage(_context, message) {
    if (message.author.isBot) return null;

    const auth = defaultLinqAuth(message);
    const authorUserName: unknown = message.author.userName;
    const phoneNumber =
      typeof authorUserName === "string"
        ? normalizeAuthPhoneNumber(authorUserName)
        : undefined;
    const verifiedUserId = phoneNumber
      ? await findVerifiedAuthUserIdByPhoneNumber(phoneNumber)
      : undefined;
    const principalId = verifiedUserId
      ? `better-auth:${verifiedUserId}`
      : auth.principalId;
    const scope = accessScopeForUser(principalId);
    return {
      auth: {
        ...auth,
        attributes: {
          ...auth.attributes,
          workspaceId: scope.workspaceId,
        },
        principalId,
      },
    };
  },
});

async function findVerifiedAuthUserIdByPhoneNumber(phoneNumber: string) {
  const context = await auth.$context;
  const user = await context.adapter.findOne({
    model: "user",
    where: [{ field: "phoneNumber", value: phoneNumber }],
  });
  const parsed = verifiedPhoneUserSchema.safeParse(user);
  return parsed.success ? parsed.data.id : undefined;
}
