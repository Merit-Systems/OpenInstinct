import { auth } from "@googleapis/gmail";
import { createLogger, parseError } from "evlog";
import { z } from "zod";
import { start } from "workflow/api";
import { env } from "@/env";
import { ensureApplicationWorkflowWorld } from "../_lib/workflow-world";
import { gmailEventWorkflow } from "../_workflows/automations";

const pubsubEnvelopeSchema = z.object({
  message: z.object({
    data: z.string().min(1),
    messageId: z.string().min(1),
    publishTime: z.string().optional(),
  }),
  subscription: z.string().optional(),
});

const gmailNotificationSchema = z.object({
  emailAddress: z.email(),
  historyId: z.string().regex(/^\d+$/u),
});

export async function POST(request: Request) {
  const log = createLogger({ operation: "automation.gmail.push" });
  try {
    if (!env.GMAIL_PUBSUB_AUDIENCE || !env.GMAIL_PUBSUB_SERVICE_ACCOUNT) {
      throw new Error(
        "GMAIL_PUBSUB_AUDIENCE and GMAIL_PUBSUB_SERVICE_ACCOUNT are required."
      );
    }
    const authorization = request.headers.get("authorization");
    const idToken = /^Bearer (.+)$/iu.exec(authorization ?? "")?.[1];
    if (!idToken) {
      return Response.json(
        { error: "Missing Pub/Sub identity" },
        { status: 401 }
      );
    }
    const ticket = await new auth.OAuth2().verifyIdToken({
      audience: env.GMAIL_PUBSUB_AUDIENCE,
      idToken,
    });
    const claims = ticket.getPayload();
    if (
      claims?.email !== env.GMAIL_PUBSUB_SERVICE_ACCOUNT ||
      claims.email_verified !== true
    ) {
      return Response.json(
        { error: "Unexpected Pub/Sub identity" },
        { status: 403 }
      );
    }

    const envelope = pubsubEnvelopeSchema.parse(await request.json());
    const decodedNotification: unknown = JSON.parse(
      Buffer.from(envelope.message.data, "base64url").toString("utf8")
    );
    const notification = gmailNotificationSchema.parse(decodedNotification);
    log.set({ claims, envelope, notification });
    await ensureApplicationWorkflowWorld();
    const run = await start(
      gmailEventWorkflow,
      [
        {
          ...notification,
          messageId: envelope.message.messageId,
        },
      ],
      {
        attributes: {
          emailAddress: notification.emailAddress,
          pubsubMessageId: envelope.message.messageId,
          trigger: "gmail-event",
        },
        deploymentId: "latest",
      }
    );
    log.set({ workflowRunId: run.runId });
    log.info("Gmail push event accepted");
    return new Response(null, { status: 204 });
  } catch (error) {
    log.error(error instanceof Error ? error : String(error), {
      failure: parseError(error),
    });
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  } finally {
    log.emit();
  }
}
