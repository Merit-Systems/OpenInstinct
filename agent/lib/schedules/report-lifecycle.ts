import type { SessionContext } from "eve/context";
import { z } from "zod";
import {
  finalizeScheduledReport,
  releaseScheduledReport,
} from "@/db/services/scheduled-agent-jobs";

export function scheduledReportFromSession(session: SessionContext) {
  const caller = session.session.auth.current ?? session.session.auth.initiator;
  if (caller?.authenticator !== "scheduled-result") return undefined;
  const parsed = z
    .object({
      scheduledReportLeaseToken: z.string().min(1),
      scheduledReportSequence: z.coerce.number().int().positive(),
      scheduledRunId: z.uuid(),
      scheduledRunSessionId: z.string().min(1).optional(),
    })
    .safeParse(caller.attributes);
  return parsed.success
    ? {
        leaseToken: parsed.data.scheduledReportLeaseToken,
        runId: parsed.data.scheduledRunId,
        sequence: parsed.data.scheduledReportSequence,
        workerSessionId: parsed.data.scheduledRunSessionId,
      }
    : undefined;
}

export async function finalizeScheduledReportDelivery(
  session: SessionContext,
  status: "delivered" | "suppressed" = "delivered"
) {
  const report = scheduledReportFromSession(session);
  if (report) {
    await finalizeScheduledReport(report.runId, report.leaseToken, status);
  }
}

export async function releaseScheduledReportDelivery(
  session: SessionContext,
  errorMessage: string
) {
  const report = scheduledReportFromSession(session);
  if (report) {
    await releaseScheduledReport(report.runId, report.leaseToken, errorMessage);
  }
}
