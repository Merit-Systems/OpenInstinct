"use client";

import { useMutation } from "@tanstack/react-query";
import { MessageSquareIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import type { SubmitEvent } from "react";
import { authClient } from "@/app/_lib/auth-client";
import { formValue, verifyPhoneNumber } from "@/app/sign-in/_lib/phone-auth";
import { normalizeAuthPhoneNumber } from "@/auth/phone-number";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PhoneNumberField } from "./phone-field";

export function PhoneOtpAuthForm({
  callbackUrl,
  linqPhoneNumber,
}: {
  readonly callbackUrl: string;
  readonly linqPhoneNumber?: string;
}) {
  const sendOtp = useMutation({
    mutationFn: async (phoneNumberValue: string) => {
      const phoneNumber = normalizeAuthPhoneNumber(phoneNumberValue);
      if (!phoneNumber) throw new Error("Enter a valid phone number.");

      const result = await authClient.phoneNumber
        .sendOtp({ phoneNumber })
        .catch(() => {
          throw new Error("Unable to send a code. Please try again.");
        });
      if (result.error) throw new Error(phoneOtpErrorMessage(result.error));
      return phoneNumber;
    },
  });

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    sendOtp.mutate(formValue(event.currentTarget, "phone-number"));
  }

  if (sendOtp.isSuccess) {
    return (
      <VerificationCodeForm
        callbackUrl={callbackUrl}
        onUseDifferentNumber={sendOtp.reset}
        phoneNumber={sendOtp.data}
      />
    );
  }

  return (
    <>
      <FirstTimeLinqSetup phoneNumber={linqPhoneNumber} />
      <form
        className="mt-4 space-y-4"
        onSubmit={(event) => {
          submit(event);
        }}
      >
        <PhoneNumberField />
        {sendOtp.error ? (
          <p className="type-supporting-body text-destructive">
            {sendOtp.error.message}
          </p>
        ) : null}
        <Button className="w-full" disabled={sendOtp.isPending} type="submit">
          {sendOtp.isPending ? "Sending…" : "Send code"}
        </Button>
      </form>
    </>
  );
}

function VerificationCodeForm({
  callbackUrl,
  onUseDifferentNumber,
  phoneNumber,
}: {
  readonly callbackUrl: string;
  readonly onUseDifferentNumber: () => void;
  readonly phoneNumber: string;
}) {
  const router = useRouter();
  const verifyCode = useMutation({
    mutationFn: async (code: string) => {
      if (!/^\d{6}$/.test(code)) {
        throw new Error("Enter the six-digit code.");
      }

      await verifyPhoneNumber({
        code,
        errorMessage:
          "That code could not be verified. Request a new code and try again.",
        phoneNumber,
      });
    },
    onSuccess: () => {
      router.replace(callbackUrl);
      router.refresh();
    },
  });

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    verifyCode.mutate(formValue(event.currentTarget, "code").trim());
  }

  return (
    <form
      className="mt-6 space-y-4"
      onSubmit={(event) => {
        submit(event);
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="code">Verification code</Label>
        <Input
          autoComplete="one-time-code"
          id="code"
          inputMode="numeric"
          maxLength={6}
          name="code"
          pattern="[0-9]{6}"
          required
        />
      </div>
      {verifyCode.error ? (
        <p className="type-supporting-body text-destructive">
          {verifyCode.error.message}
        </p>
      ) : null}
      <Button className="w-full" disabled={verifyCode.isPending} type="submit">
        {verifyCode.isPending ? "Verifying…" : "Verify code"}
      </Button>
      <Button
        className="w-full"
        disabled={verifyCode.isPending}
        onClick={onUseDifferentNumber}
        type="button"
        variant="ghost"
      >
        Use a different number
      </Button>
    </form>
  );
}

function FirstTimeLinqSetup({
  phoneNumber,
}: {
  readonly phoneNumber?: string;
}) {
  return (
    <section className="mt-6 space-y-3 rounded-lg border border-border/60 bg-muted/30 p-4">
      <div className="space-y-1">
        <h2 className="type-supporting-body font-medium">
          First time signing in?
        </h2>
        <p className="type-caption text-muted-foreground">
          Linq requires one message from your phone before it can send a sign-in
          code.
        </p>
      </div>
      <ol className="list-decimal space-y-1 pl-4 type-caption text-muted-foreground">
        <li>Open Messages to the Linq number.</li>
        <li>Send any message from the phone number you will enter below.</li>
        <li>Return here and select Send code.</li>
      </ol>
      {phoneNumber ? (
        <Button
          className="w-full"
          nativeButton={false}
          render={
            <a aria-label="Text Linq in Messages" href={`sms:${phoneNumber}`} />
          }
          variant="outline"
        >
          <MessageSquareIcon />
          Text Linq in Messages
        </Button>
      ) : (
        <p className="type-caption text-muted-foreground">
          Find the Linq number in Vercel Connect or the Linq dashboard, text it
          once, then return here.
        </p>
      )}
    </section>
  );
}

export function phoneOtpErrorMessage(error: {
  readonly code?: string;
  readonly message?: string;
}) {
  return error.code?.startsWith("LINQ_") && error.message
    ? error.message
    : "Unable to send a code. Please try again.";
}
