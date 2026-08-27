import { createHash } from "node:crypto";
import { z } from "zod";

const MAX_FEEDBACK_LENGTH = 4_000;

const SECRET_PATTERNS: readonly (readonly [RegExp, string])[] = [
  [/\b\d{6}\b/gu, "[six-digit code redacted]"],
  [/\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9_-]{12,}\b/gu, "[api key redacted]"],
  [/\bsk-(?:proj-)?[A-Za-z0-9_-]{12,}\b/gu, "[api key redacted]"],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/gu, "[github token redacted]"],
  [/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/gu, "[aws key redacted]"],
  [/\bAIza[A-Za-z0-9_-]{30,}\b/gu, "[google api key redacted]"],
  [/\bbu_[A-Za-z0-9_-]{20,}\b/gu, "[browser api key redacted]"],
  [/\bxox[baprs]-[A-Za-z0-9-]{20,}\b/gu, "[slack token redacted]"],
  [/\b(?:bearer\s+)[A-Za-z0-9._~+/-]+=*\b/giu, "Bearer [token redacted]"],
  [
    /(["'])(password|passcode|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|client[_ -]?secret|private[_ -]?key)\1\s*:\s*(?:"[^"]*"|'[^']*'|[^\s,;}]+)/giu,
    '$1$2$1: "[credential redacted]"',
  ],
  [
    /\b(password|passcode|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|client[_ -]?secret|private[_ -]?key)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/giu,
    "$1=[credential redacted]",
  ],
  [
    /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/gu,
    "[private key redacted]",
  ],
  [
    /\b([A-Z][A-Z0-9_]*(?:PASSWORD|PASSCODE|SECRET|TOKEN|API_KEY|PRIVATE_KEY|DATABASE_URL))\s*=\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/giu,
    "$1=[credential redacted]",
  ],
  [
    /\b([a-z][a-z0-9+.-]*:\/\/[^/\s:@]+):[^@\s/]+@/giu,
    "$1:[credential redacted]@",
  ],
  [/\b(?:\d[ -]*?){13,19}\b/gu, "[payment number redacted]"],
];

const feedbackCategorySchema = z.enum(["general", "bug", "idea", "compliment"]);

export const feedbackInputSchema = z.object({
  category: feedbackCategorySchema.default("general"),
  feedback: z.string().trim().min(1).max(MAX_FEEDBACK_LENGTH),
});

export const feedbackRecordSchema = z.object({
  category: feedbackCategorySchema,
  createdAt: z.string(),
  feedback: z.string(),
  id: z.string(),
  status: z.enum(["new", "reviewed", "archived"]),
});

export type FeedbackSubmission = z.infer<typeof feedbackInputSchema> & {
  readonly idempotencyKey: string;
  readonly sessionId: string;
  readonly toolCallId: string;
  readonly turnId: string;
};

export function normalizeFeedback(value: string): string {
  let feedback = value.trim().slice(0, MAX_FEEDBACK_LENGTH);
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    feedback = feedback.replace(pattern, replacement);
  }
  feedback = feedback.slice(0, MAX_FEEDBACK_LENGTH).trim();
  if (!feedback) throw new Error("Feedback cannot be empty.");
  return feedback;
}

export function feedbackIdempotencyKey(
  input: Pick<
    FeedbackSubmission,
    "category" | "feedback" | "sessionId" | "turnId"
  >
): string {
  const digest = createHash("sha256")
    .update(input.category)
    .update("\0")
    .update(normalizeFeedback(input.feedback))
    .digest("hex");
  return `give-feedback:${input.sessionId}:${input.turnId}:${digest}`;
}
