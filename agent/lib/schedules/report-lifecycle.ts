import { performScheduledCommand } from "./request";
import type { SessionContext } from "eve/context";
import { finalizeScheduledReport } from "@db/services/scheduled-agent-jobs";
import { scheduledReportIdentity } from "@agent/lib/schedules/identity";

export function scheduledReportFromSession(session: SessionContext) {
  return scheduledReportIdentity(session.session.auth);
}

export async function finalizeScheduledReportDelivery(
  session: SessionContext,
  status: "delivered" | "suppressed" = "delivered"
) {
  const report = scheduledReportFromSession(session);
  if (report) {
    const finalized = await finalizeScheduledReport(
      report.runId,
      report.leaseToken,
      status
    );
    if (finalized) {
      console.info("[scheduled-run] report finalized", {
        runId: report.runId,
        sessionId: session.session.id,
        status,
      });
    }
  }
}

export async function releaseScheduledReportDelivery(
  session: SessionContext,
  errorMessage: string
) {
  const report = scheduledReportFromSession(session);
  if (report) {
    await performScheduledCommand({
      kind: "release-report",
      runId: report.runId,
      leaseToken: report.leaseToken,
      message: errorMessage,
      at: new Date().toISOString(),
    });
    console.warn("[scheduled-run] report turn failed", {
      runId: report.runId,
      sessionId: session.session.id,
    });
  }
}
