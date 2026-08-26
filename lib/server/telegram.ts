import { randomBytes } from "node:crypto";
import { z } from "zod";

const botTokenSchema = z
  .string()
  .trim()
  .regex(/^\d+:[A-Za-z0-9_-]{20,}$/, "Enter the token from BotFather.");

const storedCredentialsSchema = z.object({
  botToken: botTokenSchema,
  webhookSecretToken: z.string().min(32).max(256),
});

const botProfileSchema = z.object({
  first_name: z.string(),
  id: z.number(),
  is_bot: z.literal(true),
  username: z.string().min(1),
});

const updateSchema = z
  .object({ update_id: z.number().int().nonnegative() })
  .loose();

const apiResponseSchema = z.object({
  description: z.string().optional(),
  ok: z.boolean(),
  result: z.unknown().optional(),
});

const apiRequestBodySchema = z.union([
  z.object({ drop_pending_updates: z.boolean() }),
  z.object({
    allowed_updates: z.array(z.string()),
    offset: z.number().optional(),
    timeout: z.number(),
  }),
]);

export async function prepareTelegramConnection(
  token: string,
  fetchImplementation: typeof fetch = fetch
) {
  const botToken = botTokenSchema.parse(token);
  const profile = botProfileSchema.parse(
    await callTelegramApi({
      botToken,
      fetchImplementation,
      method: "getMe",
    })
  );

  await callTelegramApi({
    body: { drop_pending_updates: false },
    botToken,
    fetchImplementation,
    method: "deleteWebhook",
  });

  return {
    account: profile.username,
    endpoint: `https://t.me/${profile.username}`,
    secret: JSON.stringify({
      botToken,
      webhookSecretToken: randomBytes(32).toString("base64url"),
    } satisfies z.infer<typeof storedCredentialsSchema>),
  };
}

export function parseTelegramCredentials(value: string) {
  return storedCredentialsSchema.parse(JSON.parse(value));
}

export async function getTelegramUpdates({
  botToken,
  fetchImplementation = fetch,
  offset,
}: {
  readonly botToken: string;
  readonly fetchImplementation?: typeof fetch;
  readonly offset?: number;
}) {
  const result = await callTelegramApi({
    body: {
      allowed_updates: ["message", "callback_query"],
      offset,
      timeout: 25,
    },
    botToken: botTokenSchema.parse(botToken),
    fetchImplementation,
    method: "getUpdates",
  });

  return z.array(updateSchema).parse(result);
}

async function callTelegramApi({
  body,
  botToken,
  fetchImplementation,
  method,
}: {
  readonly body?: z.infer<typeof apiRequestBodySchema>;
  readonly botToken: string;
  readonly fetchImplementation: typeof fetch;
  readonly method: string;
}) {
  let response: Response;
  try {
    response = await fetchImplementation(
      `https://api.telegram.org/bot${botToken}/${method}`,
      {
        body: JSON.stringify(body ? apiRequestBodySchema.parse(body) : {}),
        headers: { "Content-Type": "application/json" },
        method: "POST",
        signal: AbortSignal.timeout(35_000),
      }
    );
  } catch {
    throw new Error("Telegram could not be reached. Try again.");
  }

  const parsed = apiResponseSchema.safeParse(await response.json());
  if (!parsed.success || !response.ok || !parsed.data.ok) {
    throw new Error(
      parsed.success && parsed.data.description
        ? `Telegram: ${parsed.data.description}`
        : "Telegram rejected the bot token."
    );
  }

  return parsed.data.result;
}
