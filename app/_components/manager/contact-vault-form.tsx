"use client";

import { type FormEvent, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import type { ManagerMutation } from "@/lib/manager";
import { serializeContactVaultPayload } from "@/lib/manager/vault-payload";
import { VaultFormField } from "./vault-form-field";

const contactFormSchema = z
  .object({
    email: z.string().trim(),
    fullName: z.string().trim(),
    nickname: z
      .string()
      .trim()
      .min(1, "Enter a name for this contact.")
      .max(120),
    phone: z.string().trim(),
  })
  .superRefine((form, context) => {
    if (form.email && !z.email().safeParse(form.email).success) {
      context.addIssue({
        code: "custom",
        message: "Enter a valid email address.",
        path: ["email"],
      });
    }
  })
  .refine((form) => [form.email, form.fullName, form.phone].some(Boolean), {
    message: "Enter at least one contact value.",
    path: ["fullName"],
  });

export function ContactVaultForm({
  busy,
  initialLabel = "",
  onSaved,
  onSubmit,
}: {
  readonly busy: boolean;
  readonly initialLabel?: string;
  readonly onSaved: () => void;
  readonly onSubmit: (mutation: ManagerMutation) => Promise<boolean>;
}) {
  const [attempted, setAttempted] = useState(false);
  const [form, setForm] = useState({
    email: "",
    fullName: "",
    nickname: initialLabel,
    phone: "",
  });
  const result = contactFormSchema.safeParse(form);
  const errors =
    attempted && !result.success ? result.error.flatten().fieldErrors : {};

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setAttempted(true);
    if (!result.success) return;
    const saved = await onSubmit({
      action: "vault.create",
      input: {
        account: "",
        kind: "contact",
        label: result.data.nickname,
        secret: serializeContactVaultPayload({
          email: result.data.email.length ? result.data.email : undefined,
          fullName: result.data.fullName.length
            ? result.data.fullName
            : undefined,
          kind: "contact",
          phone: result.data.phone.length ? result.data.phone : undefined,
          version: 1,
        }),
      },
    });
    if (saved) onSaved();
  };

  const update = (field: keyof typeof form, value: string) =>
    setForm((current) => ({ ...current, [field]: value }));

  return (
    <form noValidate onSubmit={(event) => void submit(event)}>
      <FieldGroup className="gap-3">
        <VaultFormField
          error={errors.nickname?.[0]}
          id="vault-contact-label"
          label="Name"
          onChange={(value) => update("nickname", value)}
          placeholder="Checkout"
          value={form.nickname}
        />
        <VaultFormField
          autoComplete="name"
          error={errors.fullName?.[0]}
          id="vault-contact-name"
          label="Full name (optional)"
          onChange={(value) => update("fullName", value)}
          value={form.fullName}
        />
        <VaultFormField
          autoComplete="email"
          error={errors.email?.[0]}
          id="vault-contact-email"
          label="Email (optional)"
          onChange={(value) => update("email", value)}
          type="email"
          value={form.email}
        />
        <VaultFormField
          autoComplete="tel"
          error={errors.phone?.[0]}
          id="vault-contact-phone"
          label="Phone (optional)"
          onChange={(value) => update("phone", value)}
          type="tel"
          value={form.phone}
        />
      </FieldGroup>
      <div className="mt-5 flex justify-end">
        <Button disabled={busy} type="submit">
          Save contact
        </Button>
      </div>
    </form>
  );
}
