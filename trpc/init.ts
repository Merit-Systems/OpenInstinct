import { initTRPC, TRPCError } from "@trpc/server";
import { AdminNotFoundError, requireAdminScopeFor } from "@/lib/admin";
import type { TRPCContext } from "./context";

const t = initTRPC.context<TRPCContext>().create();

export const createTRPCRouter = t.router;
export const protectedProcedure = t.procedure;
export const adminProcedure = t.procedure.use(async ({ ctx, next }) => {
  try {
    await requireAdminScopeFor(ctx.scope);
  } catch (error) {
    if (error instanceof AdminNotFoundError) {
      throw new TRPCError({ code: "NOT_FOUND" });
    }
    throw error;
  }
  return next();
});
