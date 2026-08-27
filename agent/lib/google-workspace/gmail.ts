import { createHash } from "node:crypto";
import type { ToolContext } from "eve/tools";
import { z } from "zod";
import {
  decodeBase64Url,
  encodeBase64Url,
  googleWorkspaceFetch,
  redactGoogleText,
} from "./client";

const gmailPartSchema = z.object({
  body: z
    .object({
      attachmentId: z.string().optional(),
      data: z.string().optional(),
      size: z.number().optional(),
    })
    .optional(),
  filename: z.string().optional(),
  headers: z
    .array(
      z.object({
        name: z.string().optional(),
        value: z.string().optional(),
      })
    )
    .optional(),
  mimeType: z.string().optional(),
  parts: z.array(z.unknown()).optional(),
});

const gmailMessageSchema = z.object({
  id: z.string().optional(),
  labelIds: z.array(z.string()).optional(),
  payload: gmailPartSchema.optional(),
  snippet: z.string().optional(),
  threadId: z.string().optional(),
});

const gmailListSchema = z.object({
  messages: z.array(z.object({ id: z.string() })).optional(),
});

const gmailThreadSchema = z.object({
  id: z.string().optional(),
  messages: z.array(gmailMessageSchema).optional(),
});

type GmailMessage = z.infer<typeof gmailMessageSchema>;
type GmailPart = z.infer<typeof gmailPartSchema>;

export const GMAIL_UPDATE_ACTIONS = [
  "archive",
  "move_to_inbox",
  "mark_read",
  "mark_unread",
  "star",
  "unstar",
] as const;

export type GmailUpdateAction = (typeof GMAIL_UPDATE_ACTIONS)[number];

export const gmailSendSchema = z.object({
  bcc: z.array(z.email()).max(20).default([]),
  body: z.string().min(1).max(100_000),
  cc: z.array(z.email()).max(20).default([]),
  inReplyTo: z.string().max(998).optional(),
  subject: z.string().min(1).max(998),
  threadId: z.string().max(200).optional(),
  to: z.array(z.email()).min(1).max(20),
});

export async function searchGmail(
  ctx: ToolContext,
  query: string,
  maxResults: number
) {
  const listed = await googleWorkspaceFetch(
    ctx,
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=${String(maxResults)}`,
    gmailListSchema
  );
  const messages = await Promise.all(
    (listed.messages ?? []).map(({ id }) =>
      googleWorkspaceFetch(
        ctx,
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date&metadataHeaders=Message-ID`,
        gmailMessageSchema
      )
    )
  );
  return messages.map(minimizeMessage);
}

export async function readGmailThread(ctx: ToolContext, threadId: string) {
  const thread = await googleWorkspaceFetch(
    ctx,
    `https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}?format=full`,
    gmailThreadSchema
  );
  return {
    id: thread.id ?? threadId,
    messages: (thread.messages ?? []).slice(-20).map((message) => ({
      ...minimizeMessage(message),
      attachments: collectAttachments(message.payload),
      body: redactGoogleText(plainText(message.payload)),
    })),
  };
}

export async function updateGmail(
  ctx: ToolContext,
  messageIds: string[],
  action: GmailUpdateAction
) {
  const ids = [...new Set(messageIds)];
  await googleWorkspaceFetch(
    ctx,
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/batchModify",
    z.void(),
    {
      body: JSON.stringify({ ids, ...gmailUpdateLabels(action) }),
      method: "POST",
    }
  );
  return { action, updatedCount: ids.length };
}

export async function sendGmail(
  ctx: ToolContext,
  payload: z.infer<typeof gmailSendSchema>
) {
  const stableId = createHash("sha256")
    .update(`${ctx.session.id}:${ctx.callId}`)
    .digest("hex")
    .slice(0, 48);
  const headers = [
    `To: ${payload.to.map(safeHeader).join(", ")}`,
    ...(payload.cc.length
      ? [`Cc: ${payload.cc.map(safeHeader).join(", ")}`]
      : []),
    ...(payload.bcc.length
      ? [`Bcc: ${payload.bcc.map(safeHeader).join(", ")}`]
      : []),
    `Subject: ${safeHeader(payload.subject)}`,
    `Message-ID: <openinstinct-${stableId}@local>`,
    ...(payload.inReplyTo
      ? [
          `In-Reply-To: ${safeHeader(payload.inReplyTo)}`,
          `References: ${safeHeader(payload.inReplyTo)}`,
        ]
      : []),
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
  ];
  const raw = encodeBase64Url(`${headers.join("\r\n")}\r\n\r\n${payload.body}`);
  return googleWorkspaceFetch(
    ctx,
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    z.object({ id: z.string(), threadId: z.string() }),
    {
      body: JSON.stringify({
        raw,
        ...(payload.threadId ? { threadId: payload.threadId } : {}),
      }),
      method: "POST",
    }
  );
}

export function gmailUpdateLabels(action: GmailUpdateAction) {
  switch (action) {
    case "archive":
      return { addLabelIds: [], removeLabelIds: ["INBOX"] };
    case "move_to_inbox":
      return { addLabelIds: ["INBOX"], removeLabelIds: [] };
    case "mark_read":
      return { addLabelIds: [], removeLabelIds: ["UNREAD"] };
    case "mark_unread":
      return { addLabelIds: ["UNREAD"], removeLabelIds: [] };
    case "star":
      return { addLabelIds: ["STARRED"], removeLabelIds: [] };
    case "unstar":
      return { addLabelIds: [], removeLabelIds: ["STARRED"] };
  }
}

function header(part: GmailPart | undefined, name: string) {
  return (
    part?.headers?.find(
      (item) => item.name?.toLowerCase() === name.toLowerCase()
    )?.value ?? null
  );
}

function plainText(part: GmailPart | undefined): string {
  if (!part) return "";
  if (part.mimeType === "text/plain" && part.body?.data) {
    return decodeBase64Url(part.body.data);
  }
  for (const child of part.parts ?? []) {
    const parsed = gmailPartSchema.safeParse(child);
    const text = parsed.success ? plainText(parsed.data) : "";
    if (text) return text;
  }
  if (part.mimeType === "text/html" && part.body?.data) {
    return decodeBase64Url(part.body.data)
      .replace(/<[^>]+>/gu, " ")
      .replace(/\s+/gu, " ");
  }
  return "";
}

function minimizeMessage(message: GmailMessage) {
  return {
    date: header(message.payload, "Date"),
    from: header(message.payload, "From"),
    id: message.id ?? null,
    labels: message.labelIds ?? [],
    messageId: header(message.payload, "Message-ID"),
    snippet: redactGoogleText(message.snippet ?? "", 500),
    subject: header(message.payload, "Subject"),
    threadId: message.threadId ?? null,
    to: header(message.payload, "To"),
  };
}

function collectAttachments(part: GmailPart | undefined): {
  attachmentId: string;
  filename: string;
  size: number;
}[] {
  if (!part) return [];
  const own =
    part.filename && part.body?.attachmentId
      ? [
          {
            attachmentId: part.body.attachmentId,
            filename: part.filename,
            size: part.body.size ?? 0,
          },
        ]
      : [];
  const nested = (part.parts ?? []).flatMap((child) => {
    const parsed = gmailPartSchema.safeParse(child);
    return parsed.success ? collectAttachments(parsed.data) : [];
  });
  return [...own, ...nested];
}

function safeHeader(value: string) {
  return value.replace(/[\r\n]+/gu, " ").trim();
}
