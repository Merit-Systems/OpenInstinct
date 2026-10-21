import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { defineMemory, defineMemoryProvider } from "eve/memory";
import { defineTool } from "eve/tools";
import { z } from "zod";

export default defineMemory({
  scope: "fixture",
  provider: defineMemoryProvider({
    async tools(context) {
      return {
        verify: defineTool({
          description:
            "Verify the trusted receipt exists before memory tool execution.",
          inputSchema: z.strictObject({}),
          async execute() {
            return z
              .object({ kind: z.string(), observedAt: z.iso.datetime() })
              .parse(
                JSON.parse(
                  await readFile(
                    join(
                      ".eve",
                      "fixture-memory",
                      context.session.id,
                      `${context.turn.id}.receipt.json`
                    ),
                    "utf8"
                  )
                )
              );
          },
        }),
      };
    },

    recall: {
      async "turn.started"(context) {
        const directory = join(".eve", "fixture-memory", context.session.id);
        await mkdir(directory, { recursive: true });
        await writeFile(
          join(directory, `${context.turn.id}.json`),
          JSON.stringify(
            context.turn.input.map((message) => ({
              role: message.role,
              kind: "kind" in message ? message.kind : null,
            }))
          )
        );
        return {
          messages: [
            { id: "provenance", content: "Runtime provenance fixture." },
          ],
        };
      },
    },
  }),
});
