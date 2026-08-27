"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

type AuthStep = "phone-number" | "verification-code";

export function PhoneAuthForm({
  callbackUrl,
}: {
  readonly callbackUrl: string;
}) {
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [step, setStep] = useState<AuthStep>("phone-number");
  const [verificationCode, setVerificationCode] = useState("");

  async function submitDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    if (!/^\+[1-9]\d{7,14}$/.test(phoneNumber)) {
      setError(
        "Enter a phone number in international format, such as +12025550123."
      );
      return;
    }
    setLoading(true);
    try {
      const result = await authClient.phoneNumber.sendOtp({ phoneNumber });
      if (result.error) throw new Error(result.error.message);
      setStep("verification-code");
    } catch {
      setError("Unable to send a code. Please try again.");
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
      const verified = await authClient.phoneNumber.verify({
        code,
        disableSession: false,
        phoneNumber,
        updatePhoneNumber: false,
      });
      if (verified.error) throw new Error(verified.error.message);
      navigateAfterAuth();
    } catch {
      setError(
        "That code could not be verified. Request a new code and try again."
      );
    } finally {
      setLoading(false);
    }
  }

  function navigateAfterAuth() {
    window.location.assign(callbackUrl);
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
          placeholder="+12025550123"
          required
          type="tel"
          value={phoneNumber}
        />
      </div>
      {error ? (
        <p className="type-supporting-body text-destructive">{error}</p>
      ) : null}
      <Button className="w-full" disabled={loading} type="submit">
        {loading ? "Sending…" : "Send code"}
      </Button>
    </form>
  );
}
