import { z } from "zod";

const nodeErrorSchema = z.object({ code: z.string() });

export function nodeErrorCode(
  error: Parameters<typeof nodeErrorSchema.safeParse>[0]
) {
  return nodeErrorSchema.safeParse(error).data?.code;
}
