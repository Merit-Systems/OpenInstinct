import type { SessionContext } from "eve/context";
import { z } from "zod";

const scheduledReportIdentitySchema = z.object({
  scheduledReportLeaseToken: z.uuid(),
  scheduledReportSequence: z.coerce.number().int().positive(),
  scheduledRunId: z.uuid(),
  scheduledRunSessionId: z.string().min(1).optional(),
});

export function scheduledReportIdentity(
  auth: SessionContext["session"]["auth"]
) {
  const caller = auth.current ?? auth.initiator;
  if (caller?.authenticator !== "scheduled-result") return undefined;
  const identity = scheduledReportIdentitySchema.safeParse(caller.attributes);
  return identity.success
    ? {
        leaseToken: identity.data.scheduledReportLeaseToken,
        runId: identity.data.scheduledRunId,
        sequence: identity.data.scheduledReportSequence,
        workerSessionId: identity.data.scheduledRunSessionId,
      }
    : undefined;
}
