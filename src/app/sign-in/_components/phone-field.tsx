import { Input } from "@/components/ui/input";

export function PhoneNumberField() {
  return (
    <div className="space-y-2">
      <Input
        autoComplete="tel"
        size="xl"
        id="phone-number"
        name="phone-number"
        placeholder="(202) 555-0123"
        required
        type="tel"
      />
    </div>
  );
}
