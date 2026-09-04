import type { SessionContext } from "eve/context";
import { z } from "zod";

const proactionIdentitySchema = z.object({
  proactionId: z.string().min(1),
  scheduledRunId: z.uuid(),
});

// A proaction session is an ordinary scheduled worker or report session whose
// principal carries the proaction id, so every mode-gated capability keeps
// working and only proaction-specific behavior branches on this identity.
export function proactionIdentity(auth: SessionContext["session"]["auth"]) {
  const caller = [auth.current, auth.initiator].find(
    (principal) =>
      principal?.authenticator === "scheduled-worker" ||
      principal?.authenticator === "scheduled-result"
  );
  if (!caller) return undefined;
  const identity = proactionIdentitySchema.safeParse(caller.attributes);
  return identity.success
    ? {
        proactionId: identity.data.proactionId,
        role:
          caller.authenticator === "scheduled-worker"
            ? ("worker" as const)
            : ("report" as const),
        runId: identity.data.scheduledRunId,
      }
    : undefined;
}
