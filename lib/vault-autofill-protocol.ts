import { z } from "zod";

export const autofillSurfaceKindSchema = z.string().trim().min(1).max(80);

const detectedAutofillFieldSchema = z.object({
  score: z.number().min(0).max(100),
  token: z.string().trim().min(1).max(80),
});

const detectedAutofillSurfaceSchema = z.object({
  fields: z.array(detectedAutofillFieldSchema).min(1).max(40),
  id: z.string().trim().min(1).max(120),
  kind: autofillSurfaceKindSchema,
});

export const autofillInspectionSchema = z.object({
  origin: z.url(),
  surfaces: z.array(detectedAutofillSurfaceSchema).max(12),
});

export const autofillSuggestionSchema = z.object({
  candidateId: z.string().trim().min(1).max(500),
  label: z.string().trim().min(1).max(120),
  matchReason: z.string().trim().min(1).max(200),
  summary: z.string().trim().max(200),
});

const autofillClaimSchema = z.object({
  id: z.uuid(),
  token: z.string().trim().min(1).max(80),
  value: z.string().min(1).max(20_000),
});

export const vaultAutofillCommandSchema = z.object({
  claims: z.array(autofillClaimSchema).min(1).max(40),
  expectedOrigin: z.url(),
  expiresAt: z.number(),
  issuedAt: z.number(),
  nonce: z.string().min(16).max(200),
  surfaceId: z.string().trim().min(1).max(120),
  version: z.literal(1),
});

const autofillClaimResultSchema = z.object({
  claimId: z.string().min(1),
  status: z.enum(["filled", "missing", "rejected"]),
});

export const vaultAutofillExtensionResultSchema = z.object({
  claims: z.array(autofillClaimResultSchema),
  origin: z.url(),
  success: z.boolean(),
  surfaceId: z.string(),
});

export type AutofillClaim = z.infer<typeof autofillClaimSchema>;
export type AutofillClaimResult = z.infer<typeof autofillClaimResultSchema>;
export type AutofillInspection = z.infer<typeof autofillInspectionSchema>;
export type AutofillSuggestion = z.infer<typeof autofillSuggestionSchema>;
export type AutofillSurfaceKind = z.infer<typeof autofillSurfaceKindSchema>;
export type DetectedAutofillField = z.infer<typeof detectedAutofillFieldSchema>;
export type DetectedAutofillSurface = z.infer<
  typeof detectedAutofillSurfaceSchema
>;
export type VaultAutofillCommand = z.infer<typeof vaultAutofillCommandSchema>;
export type VaultAutofillExtensionResult = z.infer<
  typeof vaultAutofillExtensionResultSchema
>;
export interface VaultAutofillFrameInspection {
  readonly origin: string;
  readonly surfaces: readonly DetectedAutofillSurface[];
}

export interface VaultAutofillFrameFillRequest {
  readonly claims: readonly AutofillClaim[];
}

export interface VaultAutofillFrameFillResult {
  readonly claims: readonly AutofillClaimResult[];
  readonly origin: string;
}
