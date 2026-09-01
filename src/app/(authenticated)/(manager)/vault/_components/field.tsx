"use client";

import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export function FormField({
  error,
  id,
  label,
  onChange,
  ...inputProps
}: Omit<React.ComponentProps<typeof Input>, "onChange"> & {
  readonly error?: string;
  readonly label: string;
  readonly onChange: (value: string) => void;
}) {
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        {...inputProps}
        aria-invalid={error ? true : undefined}
        id={id}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
      <FieldError errors={error ? [{ message: error }] : undefined} />
    </Field>
  );
}
