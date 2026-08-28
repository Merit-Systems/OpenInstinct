import { z } from "zod";

const modelCatalogItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  ownedBy: z.string(),
  pricing: z
    .object({
      input: z.number().nonnegative().optional(),
      output: z.number().nonnegative().optional(),
    })
    .optional(),
});

export const modelCatalogSchema = z.array(modelCatalogItemSchema);
export type ModelCatalogItem = z.infer<typeof modelCatalogItemSchema>;
