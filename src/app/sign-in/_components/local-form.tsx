"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { formValue, verifyPhoneNumber } from "@/app/sign-in/_lib/phone-auth";
import { normalizeAuthPhoneNumber } from "@/auth/phone-number";
import { Button } from "@/components/ui/button";
import { PhoneNumberField } from "./phone-field";

export function LocalPhoneAuthForm({
  callbackUrl,
}: {
  readonly callbackUrl: string;
}) {
  const router = useRouter();
  const signIn = useMutation({
    mutationFn: async (phoneNumberValue: string) => {
      const phoneNumber = normalizeAuthPhoneNumber(phoneNumberValue);
      if (!phoneNumber) throw new Error("Enter a valid phone number.");

      await verifyPhoneNumber({
        code: "000000",
        errorMessage: "Unable to sign in locally. Please try again.",
        phoneNumber,
      });
    },
    onSuccess: () => {
      router.replace(callbackUrl);
      router.refresh();
    },
  });

  return (
    <form
      className="mt-6 space-y-6"
      onSubmit={(event) => {
        event.preventDefault();
        signIn.mutate(formValue(event.currentTarget, "phone-number"));
      }}
    >
      <PhoneNumberField />
      {signIn.error ? (
        <p className="type-supporting-body text-destructive">
          {signIn.error.message}
        </p>
      ) : null}
      <Button
        className="w-full"
        disabled={signIn.isPending}
        type="submit"
        size="lg"
      >
        {signIn.isPending ? "Signing in…" : "Continue"}
      </Button>
    </form>
  );
}
