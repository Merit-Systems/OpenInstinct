import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export function PhoneNumberField() {
  return (
    <Field>
      <FieldLabel htmlFor="phone-number">Phone Number</FieldLabel>
      <Input
        autoComplete="tel"
        id="phone-number"
        name="phone-number"
        placeholder="(202) 555-0123"
        required
        size="xl"
        type="tel"
      />
    </Field>
  );
}
