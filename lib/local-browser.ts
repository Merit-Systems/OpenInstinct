import { z } from "zod";
import {
  vaultAutofillFieldSchema,
  vaultAutofillRequestSchema,
} from "./vault-autofill.ts";

const elementReferenceSchema = z.string().regex(/^e\d+$/u);

export const localBrowserActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("back") }),
  z.object({ action: z.literal("click"), ref: elementReferenceSchema }),
  z.object({ action: z.literal("close") }),
  z.object({
    action: z.literal("fill"),
    ref: elementReferenceSchema,
    text: z.string().max(10_000),
  }),
  z.object({ action: z.literal("inspect") }),
  z.object({
    action: z.literal("open"),
    url: z
      .url()
      .refine(
        (value) => ["http:", "https:"].includes(new URL(value).protocol),
        "Use an HTTP or HTTPS URL."
      ),
  }),
  z.object({
    action: z.literal("press"),
    key: z.string().min(1).max(80),
    ref: elementReferenceSchema.optional(),
  }),
  z.object({
    action: z.literal("scroll"),
    direction: z.enum(["down", "up"]),
    pixels: z.number().int().min(100).max(5000).default(700),
  }),
]);

const localBrowserResponseSchema = z.object({
  error: z.string().optional(),
  result: z.unknown().optional(),
});

export const localVaultAutofillSchema = vaultAutofillRequestSchema
  .omit({ browserSessionId: true, vaultItemId: true })
  .extend({
    fields: z
      .array(
        z.object({
          field: vaultAutofillFieldSchema,
          frameSelector: z.string().trim().min(1).max(1_000).optional(),
          selector: z.string().trim().min(1).max(1_000),
          value: z.string().max(20_000),
        })
      )
      .min(1)
      .max(20),
  });

export async function runLocalBrowserAction(
  input: z.infer<typeof localBrowserActionSchema>,
  signal?: AbortSignal
) {
  let response: Response;
  try {
    response = await fetch("http://127.0.0.1:4275/action", {
      body: JSON.stringify(input),
      headers: { "Content-Type": "application/json" },
      method: "POST",
      signal,
    });
  } catch {
    throw new Error(
      "The local browser is not running. Start the device app with ./bin/local-assistant."
    );
  }

  const body = localBrowserResponseSchema.parse(await response.json());
  if (!response.ok) {
    throw new Error(body.error ?? "The local browser action failed.");
  }
  return body.result;
}

export async function runLocalVaultAutofill(
  input: z.infer<typeof localVaultAutofillSchema>,
  signal?: AbortSignal
) {
  try {
    const response = await fetch("http://127.0.0.1:4275/vault-fill", {
      body: JSON.stringify(input),
      headers: { "Content-Type": "application/json" },
      method: "POST",
      signal,
    });
    if (!response.ok) {
      throw new Error("Local browser rejected the request.");
    }
    localBrowserResponseSchema.parse(await response.json());
  } catch {
    throw new Error(
      "Secure vault fill failed. Check that the local browser is open on the approved site."
    );
  }
}
