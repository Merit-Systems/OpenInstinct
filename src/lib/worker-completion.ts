import { z } from "zod";
import { browserImageArtifactReferenceSchema } from "@/lib/browser-artifact";

export const maximumWorkerCompletionImages = 4;

export const taskCompletionSchema = z.object({
  images: z
    .array(browserImageArtifactReferenceSchema)
    .max(maximumWorkerCompletionImages),
  status: z.enum(["success", "failure"]),
  message: z.string().trim().min(1),
});

const historicalTaskCompletionSchema = taskCompletionSchema.omit({
  images: true,
});

export function parseTaskCompletionOutput(output: unknown) {
  let value = output;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return undefined;
    }
  }

  const current = taskCompletionSchema.safeParse(value);
  if (current.success) return current.data;
  const historical = historicalTaskCompletionSchema.safeParse(value);
  return historical.success ? { ...historical.data, images: [] } : undefined;
}
