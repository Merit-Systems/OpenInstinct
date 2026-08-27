import { z } from "zod";

export const paymentCardSecretSchema = z.object({
  billingPostalCode: z.string().trim().min(1).max(20),
  cardholderName: z.string().trim().min(1).max(200),
  expirationMonth: z.number().int().min(1).max(12),
  expirationYear: z.number().int().min(2000).max(9999),
  kind: z.literal("payment-card"),
  number: z.string().regex(/^\d{12,19}$/u),
  securityCode: z.string().regex(/^\d{3,4}$/u),
  version: z.literal(1),
});

export const paymentCardSecretStringSchema = z
  .string()
  .superRefine((value, context) => {
    try {
      const result = paymentCardSecretSchema.safeParse(JSON.parse(value));
      if (!result.success) {
        context.addIssue({
          code: "custom",
          message: "Enter complete, valid card details.",
        });
      }
    } catch {
      context.addIssue({
        code: "custom",
        message: "Enter complete, valid card details.",
      });
    }
  });

export function serializePaymentCard(
  input: z.input<typeof paymentCardSecretSchema>
) {
  return JSON.stringify(paymentCardSecretSchema.parse(input));
}

export function parsePaymentCardSecret(value: string) {
  try {
    return paymentCardSecretSchema.parse(JSON.parse(value));
  } catch {
    throw new Error("The saved payment card is incomplete or invalid.");
  }
}

export function paymentCardBrand(number: string) {
  const digits = number.replaceAll(/\D/gu, "");
  if (digits.startsWith("4")) return "Visa";
  if (/^(5[1-5]|2(?:2[2-9]|[3-6]\d|7[01]|720))/u.test(digits)) {
    return "Mastercard";
  }
  if (/^3[47]/u.test(digits)) return "American Express";
  if (/^(6011|65|64[4-9])/u.test(digits)) return "Discover";
  return "Card";
}
