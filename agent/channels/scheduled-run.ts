import { defineChannel, POST } from "eve/channels";
import { z } from "zod";
import { scheduledRunOutcomeJsonSchema } from "@/agent/lib/schedules/outcome";
import { dispatchScheduledReport } from "@/agent/lib/schedules/report";

const targetSchema = z.strictObject({
  restart: z.boolean().optional(),
  runId: z.uuid(),
});
const reportSchema = z.strictObject({ runId: z.uuid() });

export default defineChannel({
  routes: [
    POST(
      "/internal/scheduled-run/report",
      async (request, { to, waitUntil }) => {
        const parsed = reportSchema.safeParse(await request.json());
        if (parsed.success) {
          waitUntil(dispatchScheduledReport(to, parsed.data.runId));
        }
        return new Response(null, { status: 202 });
      }
    ),
  ],
  async receive(input, context) {
    const { restart, runId } = targetSchema.parse(input.target);
    const source = context.from(`scheduled-run:${runId}`);
    if (restart) {
      await source.reset({ reason: "Scheduled worker exceeded its runtime." });
    }
    return source.send(input.message, {
      auth: input.auth,
      mode: "task",
      outputSchema: scheduledRunOutcomeJsonSchema,
      title: `Scheduled run ${runId}`,
    });
  },
});
