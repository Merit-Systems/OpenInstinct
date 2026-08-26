import { telegramChannel } from "eve/channels/telegram";
import { readTelegramCredentials } from "../../lib/server/manager-store.js";

export default telegramChannel({
  credentials: {
    botToken: async () => {
      const credentials = await requireTelegramCredentials();
      return credentials.botToken;
    },
    webhookSecretToken: async () => {
      const credentials = await requireTelegramCredentials();
      return credentials.webhookSecretToken;
    },
  },
});

async function requireTelegramCredentials() {
  const credentials = await readTelegramCredentials();
  if (!credentials) {
    throw new Error(
      "Telegram is not connected. Add a bot in the local manager."
    );
  }
  return credentials;
}
