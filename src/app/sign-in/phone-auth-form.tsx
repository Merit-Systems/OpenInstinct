"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/app/_lib/auth-client";
import { normalizeAuthPhoneNumber } from "@/auth/phone-number";

type AuthStep = "phone-number" | "verification-code";

export function PhoneAuthForm({
  callbackUrl,
  linqConfigured,
  skipOtp,
}: {
  readonly callbackUrl: string;
  readonly linqConfigured: boolean;
  readonly skipOtp: boolean;
}) {
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [step, setStep] = useState<AuthStep>("phone-number");
  const [verificationCode, setVerificationCode] = useState("");

  async function submitDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    const normalizedPhoneNumber = normalizeAuthPhoneNumber(phoneNumber);
    if (!normalizedPhoneNumber) {
      setError("Enter a valid phone number.");
      return;
    }
    setPhoneNumber(normalizedPhoneNumber);
    setLoading(true);
    try {
      if (skipOtp) {
        await verifyPhoneNumber(normalizedPhoneNumber, "000000");
        return;
      }
      const result = await authClient.phoneNumber.sendOtp({
        phoneNumber: normalizedPhoneNumber,
      });
      if (result.error) {
        setError(phoneOtpErrorMessage(result.error));
        return;
      }
      setStep("verification-code");
    } catch {
      setError(
        skipOtp
          ? "Unable to sign in locally. Please try again."
          : "Unable to send a code. Please try again."
      );
    } finally {
      setLoading(false);
    }
  }

  async function submitCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    const code = verificationCode.trim();
    if (!/^\d{6}$/.test(code)) {
      setError("Enter the six-digit code.");
      return;
    }

    setLoading(true);
    try {
      await verifyPhoneNumber(phoneNumber, code);
    } catch {
      setError(
        "That code could not be verified. Request a new code and try again."
      );
    } finally {
      setLoading(false);
    }
  }

  async function verifyPhoneNumber(phoneNumberValue: string, code: string) {
    const verified = await authClient.phoneNumber.verify({
      code,
      disableSession: false,
      phoneNumber: phoneNumberValue,
      updatePhoneNumber: false,
    });
    if (verified.error) throw new Error(verified.error.message);
    navigateAfterAuth();
  }

  function navigateAfterAuth() {
    window.location.assign(callbackUrl);
  }

  if (!skipOtp && !linqConfigured) {
    return (
      <p className="type-supporting-body mt-6 text-muted-foreground">
        iMessage sign-in is not configured for this deployment. Attach a Linq
        connector, then set LINQ_CONNECTOR and LINQ_PHONE_NUMBER.
      </p>
    );
  }

  if (step === "verification-code") {
    return (
      <form className="mt-6 space-y-4" onSubmit={submitCode}>
        <div className="space-y-2">
          <Label htmlFor="code">Verification code</Label>
          <Input
            autoComplete="one-time-code"
            id="code"
            inputMode="numeric"
            maxLength={6}
            name="code"
            onChange={(event) => setVerificationCode(event.target.value)}
            pattern="[0-9]{6}"
            required
            value={verificationCode}
          />
        </div>
        {error ? (
          <p className="type-supporting-body text-destructive">{error}</p>
        ) : null}
        <Button className="w-full" disabled={loading} type="submit">
          {loading ? "Verifying…" : "Verify code"}
        </Button>
        <Button
          className="w-full"
          disabled={loading}
          onClick={() => {
            setError(undefined);
            setStep("phone-number");
            setVerificationCode("");
          }}
          type="button"
          variant="ghost"
        >
          Use a different number
        </Button>
      </form>
    );
  }

  return (
    <form className="mt-6 space-y-4" onSubmit={submitDetails}>
      <div className="space-y-2">
        <Label htmlFor="phone-number">Phone number</Label>
        <Input
          autoComplete="tel"
          id="phone-number"
          onChange={(event) => setPhoneNumber(event.target.value.trim())}
          placeholder="(202) 555-0123"
          required
          type="tel"
          value={phoneNumber}
        />
      </div>
      {error ? (
        <p className="type-supporting-body text-destructive">{error}</p>
      ) : null}
      <Button className="w-full" disabled={loading} type="submit">
        {loading
          ? skipOtp
            ? "Signing in…"
            : "Sending…"
          : skipOtp
            ? "Continue locally"
            : "Send code"}
      </Button>
    </form>
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
