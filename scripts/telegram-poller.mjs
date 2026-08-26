const managerOrigin = process.argv[2];

if (!managerOrigin || !URL.canParse(managerOrigin)) {
  throw new Error("Telegram poller requires the local manager origin.");
}

let offset;
let botId;

process.once("SIGINT", () => process.exit(0));
process.once("SIGTERM", () => process.exit(0));

while (true) {
  try {
    const response = await fetch(new URL("/api/telegram/poll", managerOrigin), {
      body: JSON.stringify({ botId, offset }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
      signal: AbortSignal.timeout(45_000),
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error ?? "Telegram polling failed.");
    }

    if (result.botId !== botId) offset = undefined;
    botId = result.botId ?? botId;
    offset = result.nextOffset ?? offset;
    if (!result.configured) await delay(3_000);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Telegram input: ${message}`);
    await delay(3_000);
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
