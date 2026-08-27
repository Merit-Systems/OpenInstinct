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

// Suppress repeat Google onboarding prompts within one warm instance. eve keeps
// one session per Linq conversation, so a warm lambda handling that conversation
// won't re-prompt; a cold start may prompt once more, which is acceptable.
const ONBOARDING_PROMPT_TTL_MS = 60 * 60 * 1000;
const recentOnboardingPrompts = new Map<string, number>();

function claimOnboardingPrompt(key: string): boolean {
  const now = Date.now();
  const last = recentOnboardingPrompts.get(key);
  if (last !== undefined && now - last < ONBOARDING_PROMPT_TTL_MS) return false;
  recentOnboardingPrompts.set(key, now);
  if (recentOnboardingPrompts.size > 500) {
    for (const [entryKey, at] of recentOnboardingPrompts) {
      if (now - at > ONBOARDING_PROMPT_TTL_MS)
        recentOnboardingPrompts.delete(entryKey);
    }
  }
  return true;
}

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
      if (claimOnboardingPrompt(scope.workspaceId)) {
        try {
          const callbackUrl = new URL("/google-connected", env.BETTER_AUTH_URL);
          const authorizationUrl = await startGoogleWorkspaceAuthorization(
            scope,
            callbackUrl.toString()
          );
          // Keep the URL at the very end with a single leading space and nothing
          // after it: Linq flattens markdown to plain text for iMessage and drops
          // the newlines, so anything trailing the link gets glued into its path
          // and the authorization request 404s.
          await context.thread.post({
            markdown: `Welcome to Mouse! To help with your Gmail and Calendar, connect Google Workspace with this link (good for 10 minutes): ${authorizationUrl}`,
          });
          onboardingContext.push(
            "A Google Workspace authorization link was just sent to the user. Do not repeat the link; respond naturally to their message."
          );
        } catch {
          recentOnboardingPrompts.delete(scope.workspaceId);
          onboardingContext.push(
            "Google Workspace onboarding is temporarily unavailable. Do not claim that Google is connected."
          );
        }
      } else {
        onboardingContext.push(
          "The user has not connected Google Workspace yet and was already sent the link recently. Do not resend it unless they ask; only bring up Google access if it is relevant to their request."
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
