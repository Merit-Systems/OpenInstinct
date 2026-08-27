import { z } from "zod";

const boundedValue = z.string().trim().min(1).max(20_000);
const optionalBoundedValue = z
  .string()
  .trim()
  .max(20_000)
  .optional()
  .transform((value) => (value?.length ? value : undefined));

export const loginIdentifierTypeSchema = z.enum(["email", "phone", "username"]);

const loginIdentifierSchema = z.object({
  type: loginIdentifierTypeSchema,
  value: z.string().trim().min(1).max(300),
});

const loginAuthenticationSchema = z.discriminatedUnion("type", [
  z.object({
    password: z.string().min(1).max(20_000),
    type: z.literal("password"),
  }),
  z.object({ type: z.literal("email_otp") }),
  z.object({ type: z.literal("sms_otp") }),
]);

export const loginVaultPayloadSchema = z
  .object({
    authentication: loginAuthenticationSchema,
    identifier: loginIdentifierSchema,
    kind: z.literal("login"),
    version: z.literal(1),
  })
  .superRefine((payload, context) => {
    if (
      payload.identifier.type === "email" &&
      !z.email().safeParse(payload.identifier.value).success
    ) {
      context.addIssue({
        code: "custom",
        message: "Enter a valid email identifier.",
        path: ["identifier", "value"],
      });
    }
    if (
      payload.authentication.type === "email_otp" &&
      payload.identifier.type !== "email"
    ) {
      context.addIssue({
        code: "custom",
        message: "Email OTP requires an email identifier.",
        path: ["identifier", "type"],
      });
    }
    if (
      payload.authentication.type === "sms_otp" &&
      payload.identifier.type !== "phone"
    ) {
      context.addIssue({
        code: "custom",
        message: "SMS OTP requires a phone identifier.",
        path: ["identifier", "type"],
      });
    }
  });

export const addressVaultPayloadSchema = z.object({
  city: boundedValue,
  countryCode: z
    .string()
    .trim()
    .min(2)
    .max(2)
    .transform((value) => value.toUpperCase()),
  kind: z.literal("address"),
  line1: boundedValue,
  line2: optionalBoundedValue,
  postalCode: boundedValue,
  recipientName: boundedValue,
  region: boundedValue,
  version: z.literal(1),
});

export const contactVaultPayloadSchema = z
  .object({
    email: optionalBoundedValue,
    fullName: optionalBoundedValue,
    kind: z.literal("contact"),
    phone: optionalBoundedValue,
    version: z.literal(1),
  })
  .superRefine((payload, context) => {
    if (payload.email && !z.email().safeParse(payload.email).success) {
      context.addIssue({
        code: "custom",
        message: "Enter a valid contact email.",
        path: ["email"],
      });
    }
  })
  .refine(
    (payload) => [payload.email, payload.fullName, payload.phone].some(Boolean),
    { message: "Enter at least one contact value." }
  );

export const loginVaultPayloadStringSchema = serializedPayloadSchema(
  loginVaultPayloadSchema,
  "Enter complete login details."
);
export const addressVaultPayloadStringSchema = serializedPayloadSchema(
  addressVaultPayloadSchema,
  "Enter a complete address."
);
export const contactVaultPayloadStringSchema = serializedPayloadSchema(
  contactVaultPayloadSchema,
  "Enter at least one contact value."
);

export function serializeLoginVaultPayload(
  input: z.input<typeof loginVaultPayloadSchema>
) {
  return JSON.stringify(loginVaultPayloadSchema.parse(input));
}

export function serializeAddressVaultPayload(
  input: z.input<typeof addressVaultPayloadSchema>
) {
  return JSON.stringify(addressVaultPayloadSchema.parse(input));
}

export function serializeContactVaultPayload(
  input: z.input<typeof contactVaultPayloadSchema>
) {
  return JSON.stringify(contactVaultPayloadSchema.parse(input));
}

export function parseLoginVaultPayload(value: string) {
  return parseSerializedPayload(loginVaultPayloadSchema, value);
}

export function parseAddressVaultPayload(value: string) {
  return parseSerializedPayload(addressVaultPayloadSchema, value);
}

export function parseContactVaultPayload(value: string) {
  return parseSerializedPayload(contactVaultPayloadSchema, value);
}

export function loginAccountHint(
  identifier: z.infer<typeof loginIdentifierSchema>
) {
  switch (identifier.type) {
    case "email": {
      const [localPart, domain] = identifier.value.split("@", 2);
      if (!localPart || !domain) return "Saved email";
      return `${localPart.slice(0, 1)}•••@${domain}`;
    }
    case "phone":
      return `Phone · •••• ${lastCharacters(identifier.value, 4)}`;
    case "username":
      return `Username · ${identifier.value.slice(0, 2)}•••`;
  }
}

function lastCharacters(value: string, count: number) {
  return value.replaceAll(/\D/gu, "").slice(-count);
}

function serializedPayloadSchema(schema: z.ZodType, message: string) {
  return z.string().superRefine((value, context) => {
    if (!parseSerializedPayload(schema, value)) {
      context.addIssue({ code: "custom", message });
    }
  });
}

function parseSerializedPayload<T>(schema: z.ZodType<T>, value: string) {
  try {
    return schema.safeParse(JSON.parse(value)).data;
  } catch {
    return undefined;
  }
}
