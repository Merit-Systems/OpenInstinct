"use client";

import { type FormEvent, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ManagerMutation } from "@/lib/manager";
import {
  loginAuthenticationTypeSchema,
  loginIdentifierTypeSchema,
  serializeLoginVaultPayload,
} from "@/lib/vault-payload";
import { VaultFormField } from "./vault-form-field";

const loginFormSchema = z
  .object({
    authenticationType: loginAuthenticationTypeSchema,
    identifier: z.string().trim().min(1, "Enter the sign-in identifier."),
    identifierType: loginIdentifierTypeSchema,
    nickname: z.string().trim().min(1, "Enter a name for this login.").max(120),
    password: z.string(),
  })
  .superRefine((form, context) => {
    if (form.authenticationType === "password" && !form.password) {
      context.addIssue({
        code: "custom",
        message: "Enter the password.",
        path: ["password"],
      });
    }
    if (
      form.authenticationType === "email_otp" &&
      form.identifierType !== "email"
    ) {
      context.addIssue({
        code: "custom",
        message: "Email codes require an email identifier.",
        path: ["authenticationType"],
      });
    }
    if (
      form.authenticationType === "sms_otp" &&
      form.identifierType !== "phone"
    ) {
      context.addIssue({
        code: "custom",
        message: "Text-message codes require a phone identifier.",
        path: ["authenticationType"],
      });
    }
  });

export function LoginVaultForm({
  busy,
  initialIdentifier = "",
  initialLabel = "",
  onSaved,
  onSubmit,
}: {
  readonly busy: boolean;
  readonly initialIdentifier?: string;
  readonly initialLabel?: string;
  readonly onSaved: () => void;
  readonly onSubmit: (mutation: ManagerMutation) => Promise<boolean>;
}) {
  const [attempted, setAttempted] = useState(false);
  const [form, setForm] = useState<z.input<typeof loginFormSchema>>({
    authenticationType: "password",
    identifier: initialIdentifier,
    identifierType: inferIdentifierType(initialIdentifier),
    nickname: initialLabel,
    password: "",
  });
  const result = loginFormSchema.safeParse(form);
  const errors =
    attempted && !result.success ? result.error.flatten().fieldErrors : {};

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setAttempted(true);
    if (!result.success) return;

    const authentication =
      result.data.authenticationType === "password"
        ? { password: result.data.password, type: "password" as const }
        : { type: result.data.authenticationType };
    const saved = await onSubmit({
      action: "vault.create",
      input: {
        account: "",
        kind: "login",
        label: result.data.nickname,
        secret: serializeLoginVaultPayload({
          authentication,
          identifier: {
            type: result.data.identifierType,
            value: result.data.identifier,
          },
          kind: "login",
          version: 1,
        }),
      },
    });
    if (saved) onSaved();
  };

  const authenticationOptions =
    form.identifierType === "email"
      ? (["password", "email_otp"] as const)
      : form.identifierType === "phone"
        ? (["password", "sms_otp"] as const)
        : (["password"] as const);

  return (
    <form noValidate onSubmit={(event) => void submit(event)}>
      <FieldGroup className="gap-3">
        <VaultFormField
          error={errors.nickname?.[0]}
          id="vault-login-label"
          label="Name"
          onChange={(nickname) =>
            setForm((current) => ({ ...current, nickname }))
          }
          placeholder="GitHub"
          value={form.nickname}
        />
        <div className="grid gap-3 sm:grid-cols-[0.8fr_1.4fr]">
          <Field>
            <FieldLabel htmlFor="vault-login-identifier-type">
              Identifier type
            </FieldLabel>
            <Select
              onValueChange={(value) => {
                const identifierType = loginIdentifierTypeSchema.parse(value);
                setForm((current) => ({
                  ...current,
                  authenticationType: "password",
                  identifierType,
                }));
              }}
              value={form.identifierType}
            >
              <SelectTrigger
                className="w-full"
                id="vault-login-identifier-type"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="email">Email</SelectItem>
                <SelectItem value="phone">Phone</SelectItem>
                <SelectItem value="username">Username</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <VaultFormField
            autoComplete="username"
            error={errors.identifier?.[0]}
            id="vault-login-identifier"
            label="Email, phone, or username"
            onChange={(identifier) =>
              setForm((current) => ({ ...current, identifier }))
            }
            placeholder={identifierPlaceholder(form.identifierType)}
            value={form.identifier}
          />
        </div>
        <Field data-invalid={errors.authenticationType?.[0] ? true : undefined}>
          <FieldLabel htmlFor="vault-login-authentication">
            Sign-in method
          </FieldLabel>
          <Select
            onValueChange={(value) => {
              const authenticationType =
                loginAuthenticationTypeSchema.parse(value);
              setForm((current) => ({ ...current, authenticationType }));
            }}
            value={form.authenticationType}
          >
            <SelectTrigger className="w-full" id="vault-login-authentication">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {authenticationOptions.map((type) => (
                <SelectItem key={type} value={type}>
                  {authenticationLabel(type)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldError
            errors={
              errors.authenticationType?.[0]
                ? [{ message: errors.authenticationType[0] }]
                : undefined
            }
          />
        </Field>
        {form.authenticationType === "password" ? (
          <VaultFormField
            autoComplete="new-password"
            error={errors.password?.[0]}
            id="vault-login-password"
            label="Password"
            onChange={(password) =>
              setForm((current) => ({ ...current, password }))
            }
            type="password"
            value={form.password}
          />
        ) : null}
      </FieldGroup>
      <div className="mt-5 flex justify-end">
        <Button disabled={busy} type="submit">
          Save login
        </Button>
      </div>
    </form>
  );
}

function inferIdentifierType(value: string) {
  if (value.includes("@")) return "email" as const;
  if (/^\+?[\d\s().-]+$/u.test(value) && value.length > 0)
    return "phone" as const;
  return "username" as const;
}

function identifierPlaceholder(
  type: z.infer<typeof loginIdentifierTypeSchema>
) {
  if (type === "email") return "name@example.com";
  if (type === "phone") return "+1 555 555 5555";
  return "username";
}

function authenticationLabel(
  type: z.infer<typeof loginAuthenticationTypeSchema>
) {
  if (type === "email_otp") return "Email code";
  if (type === "sms_otp") return "Text-message code";
  return "Password";
}
