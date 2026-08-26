import { z } from "zod";
import { localAccessScope } from "@/lib/access-scope";
import { isLocalManagerHostname } from "@/lib/manager";
import { readTelegramCredentials } from "@/lib/server/manager-store";
import { getTelegramUpdates } from "@/lib/server/telegram";

const requestSchema = z.object({
  botId: z.string().optional(),
  offset: z.number().int().nonnegative().optional(),
});

const LOCAL_EVE_TELEGRAM_URL = "http://127.0.0.1:4274/eve/v1/telegram";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isLocalManagerHostname(new URL(request.url).hostname)) {
    return Response.json(
      { error: "Telegram polling is available only on this device." },
      { status: 403 }
    );
  }

  try {
    const { botId, offset } = requestSchema.parse(await request.json());
    const credentials = await readTelegramCredentials(localAccessScope);
    if (!credentials) {
      return Response.json({ configured: false, nextOffset: offset });
    }

    const currentBotId = credentials.botToken.split(":", 1)[0];
    const currentOffset = botId === currentBotId ? offset : undefined;

    const updates = await getTelegramUpdates({
      botToken: credentials.botToken,
      offset: currentOffset,
    });

    await Promise.all(
      updates.map(async (update) => {
        const response = await fetch(LOCAL_EVE_TELEGRAM_URL, {
          body: JSON.stringify(update),
          headers: {
            "Content-Type": "application/json",
            "X-Telegram-Bot-Api-Secret-Token": credentials.webhookSecretToken,
          },
          method: "POST",
        });
        if (!response.ok) {
          throw new Error("The local agent rejected a Telegram message.");
        }
      })
    );

    const newestUpdate = updates.at(-1);
    return Response.json({
      configured: true,
      botId: currentBotId,
      delivered: updates.length,
      nextOffset: newestUpdate ? newestUpdate.update_id + 1 : currentOffset,
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Telegram polling failed.",
      },
      { status: 503 }
    );
  }
}
