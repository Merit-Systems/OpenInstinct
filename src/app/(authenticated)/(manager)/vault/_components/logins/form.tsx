"use client";

import { type SubmitEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  loginIdentifierSchema,
  loginIdentifierTypeSchema,
  loginOriginSchema,
  serializeLoginVaultPayload,
} from "@/lib/vault";
import { api } from "@/trpc/client";
import { FormField } from "../field";

const loginFormSchema = z
  .object({
    identifier: z.string().trim(),
    identifierType: loginIdentifierTypeSchema,
    nickname: z.string().trim().min(1, "Enter a name for this login.").max(120),
    origin: z
      .string()
      .trim()
      .transform(normalizeLoginOrigin)
      .pipe(loginOriginSchema),
    password: z.string().max(20_000),
  })
  .superRefine((form, context) => {
    const identifier = loginIdentifierSchema.safeParse({
      type: form.identifierType,
      value: form.identifier,
    });
    if (!identifier.success) {
      for (const issue of identifier.error.issues) {
        context.addIssue({
          code: "custom",
          message: issue.message,
          path: ["identifier"],
        });
      }
    }
    if (form.identifierType === "username" && !form.password) {
      context.addIssue({
        code: "custom",
        message: "Username logins require a password.",
        path: ["password"],
      });
    }
  });

export function LoginForm({
  initialIdentifierType,
  initialLabel = "",
  initialOrigin = "",
  onSaved,
}: {
  readonly initialIdentifierType?: z.infer<typeof loginIdentifierTypeSchema>;
  readonly initialLabel?: string;
  readonly initialOrigin?: string;
  readonly onSaved: () => void;
}) {
  const router = useRouter();
  const create = api.vault.create.useMutation({
    onSuccess: () => {
      router.refresh();
      onSaved();
    },
  });
  const [attempted, setAttempted] = useState(false);
  const [form, setForm] = useState<z.input<typeof loginFormSchema>>({
    identifier: "",
    identifierType: initialIdentifierType ?? "email",
    nickname: initialLabel,
    origin: initialOrigin,
    password: "",
  });
  const result = loginFormSchema.safeParse(form);
  const errors =
    attempted && !result.success
      ? z.flattenError(result.error).fieldErrors
      : {};

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAttempted(true);
    if (!result.success) return;

    const authentication = loginAuthentication(result.data);
    create.mutate({
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
        origin: result.data.origin,
        version: 2,
      }),
    });
  };

  const passwordOptional = form.identifierType !== "username";

  return (
    <form noValidate onSubmit={submit}>
      <FieldGroup className="gap-3">
        {initialLabel ? null : (
          <FormField
            error={errors.nickname?.[0]}
            id="vault-login-label"
            label="Name"
            onChange={(nickname) =>
              setForm((current) => ({ ...current, nickname }))
            }
            placeholder="GitHub"
            value={form.nickname}
          />
        )}
        <FormField
          autoComplete="url"
          error={errors.origin?.[0]}
          id="vault-login-origin"
          inputMode="url"
          label="Website"
          onChange={(origin) => setForm((current) => ({ ...current, origin }))}
          placeholder="https://www.ubereats.com"
          type="url"
          value={form.origin}
        />
        <div
          className={
            initialIdentifierType
              ? undefined
              : "grid gap-3 sm:grid-cols-[0.8fr_1.4fr]"
          }
        >
          {initialIdentifierType ? null : (
            <Field>
              <FieldLabel htmlFor="vault-login-identifier-type">
                Sign in with
              </FieldLabel>
              <Select
                onValueChange={(value) => {
                  const identifierType = loginIdentifierTypeSchema.parse(value);
                  setForm((current) => ({
                    ...current,
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
          )}
          <FormField
            autoComplete="username"
            error={errors.identifier?.[0]}
            id="vault-login-identifier"
            label={identifierLabel(form.identifierType)}
            onChange={(identifier) =>
              setForm((current) => ({ ...current, identifier }))
            }
            placeholder={identifierPlaceholder(form.identifierType)}
            value={form.identifier}
          />
        </div>
        <FormField
          aria-describedby={
            passwordOptional ? "vault-login-password-description" : undefined
          }
          autoComplete="new-password"
          error={errors.password?.[0]}
          id="vault-login-password"
          label={passwordOptional ? "Password (optional)" : "Password"}
          onChange={(password) =>
            setForm((current) => ({ ...current, password }))
          }
          type="password"
          value={form.password}
        />
        {passwordOptional ? (
          <p
            className="-mt-1 type-caption text-muted-foreground"
            id="vault-login-password-description"
          >
            Leave blank if you sign in with a one-time code.
          </p>
        ) : null}
      </FieldGroup>
      <div className="mt-5 flex justify-end">
        <Button disabled={create.isPending} type="submit">
          Save login
        </Button>
      </div>
    </form>
  );
}

function identifierPlaceholder(
  type: z.infer<typeof loginIdentifierTypeSchema>
) {
  if (type === "email") return "name@example.com";
  if (type === "phone") return "+1 555 555 5555";
  return "username";
}

function identifierLabel(type: z.infer<typeof loginIdentifierTypeSchema>) {
  if (type === "email") return "Email";
  if (type === "phone") return "Phone number";
  return "Username";
}

function loginAuthentication(form: z.output<typeof loginFormSchema>) {
  if (form.password) {
    return { password: form.password, type: "password" as const };
  }
  if (form.identifierType === "email") return { type: "email_otp" as const };
  if (form.identifierType === "phone") return { type: "sms_otp" as const };
  throw new Error("Username logins require a password.");
}

function normalizeLoginOrigin(value: string) {
  const candidate = value.includes("://") ? value : `https://${value}`;
  try {
    return new URL(candidate).origin;
  } catch {
    return value;
  }
}
