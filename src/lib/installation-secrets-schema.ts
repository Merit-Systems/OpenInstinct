import { z } from "zod";

export const betterAuthSecretSchema = z
  .string()
  .refine(
    (value) => value.trim().length >= 32,
    "BETTER_AUTH_SECRET must contain at least 32 characters."
  );

export const secretEncryptionKeySchema = z
  .string()
  .refine(
    (value) => Buffer.from(value, "base64").length === 32,
    "SECRET_ENCRYPTION_KEY must be a base64-encoded 32-byte key."
  );

export const installationSecretsSchema = z.object({
  betterAuthSecret: betterAuthSecretSchema,
  secretEncryptionKey: secretEncryptionKeySchema,
  version: z.literal(1),
});

export type InstallationSecrets = z.infer<typeof installationSecretsSchema>;
