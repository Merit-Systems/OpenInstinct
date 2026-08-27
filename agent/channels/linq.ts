/* oxlint-disable typescript/no-unsafe-call, typescript/no-unsafe-member-access -- Eve's Linq adapter exposes the thread through a transitive Chat SDK type; TypeScript still checks this contextual handler. */
import { connectLinqCredentials } from "@vercel/connect/eve";
import { defaultLinqAuth, linqChannel } from "eve/channels/linq";
import { z } from "zod";
import { auth } from "@/auth";
import { accessScopeForUser } from "@/lib/access-scope";
import { env } from "@/lib/env";
import {
  getGoogleWorkspaceConnection,
  startGoogleWorkspaceAuthorization,
} from "@/lib/google-workspace/server";
import { LINQ_CONNECTOR } from "@/lib/linq";
import { normalizeAuthPhoneNumber } from "@/lib/auth/phone-number";

const verifiedPhoneUserSchema = z.object({
  id: z.string().min(1),
  phoneNumberVerified: z.literal(true),
});

export default linqChannel({
  credentials:
    env.LINQ_API_KEY && env.LINQ_WEBHOOK_SECRET
      ? {
          apiKey: env.LINQ_API_KEY,
          signingSecret: env.LINQ_WEBHOOK_SECRET,
        }
      : connectLinqCredentials(LINQ_CONNECTOR),
  async onMessage(context, message) {
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
    const googleWorkspace = await getGoogleWorkspaceConnection(scope);
    const onboardingContext: string[] = [];

    if (googleWorkspace.state === "disconnected") {
      try {
        const callbackUrl = new URL("/google-connected", env.BETTER_AUTH_URL);
        const authorizationUrl = await startGoogleWorkspaceAuthorization(
          scope,
          callbackUrl.toString()
        );
        await context.thread.post({
          markdown: [
            "Welcome to Mouse! Connect Google Workspace to give me access to your Gmail and Calendar:",
            authorizationUrl,
            "The link expires in 10 minutes.",
          ].join("\n\n"),
        });
        onboardingContext.push(
          "A Google Workspace authorization link was just sent to the user. Do not repeat the link; respond naturally to their message."
        );
      } catch {
        onboardingContext.push(
          "Google Workspace onboarding is temporarily unavailable. Do not claim that Google is connected."
        );
      }
    }

    return {
      auth: {
        ...auth,
        attributes: {
          ...auth.attributes,
          workspaceId: scope.workspaceId,
        },
        principalId,
      },
      context: onboardingContext,
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
