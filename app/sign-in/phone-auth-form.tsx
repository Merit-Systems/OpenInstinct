"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

type AuthStep = "details" | "phone-code" | "two-factor-code";

export function PhoneAuthForm({
  callbackUrl,
}: {
  readonly callbackUrl: string;
}) {
  const [creatingAccount, setCreatingAccount] = useState(false);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [password, setPassword] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [step, setStep] = useState<AuthStep>("details");
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
    if (password.length < 12) {
      setError("Use a password with at least 12 characters.");
      return;
    }

    setLoading(true);
    try {
      if (creatingAccount) {
        const result = await authClient.phoneNumber.sendOtp({ phoneNumber });
        if (result.error) throw new Error(result.error.message);
        setStep("phone-code");
        return;
      }

      const result = await authClient.signIn.phoneNumber({
        password,
        phoneNumber,
        rememberMe: false,
      });
      if (result.error) throw new Error(result.error.message);
      if (
        result.data &&
        "twoFactorRedirect" in result.data &&
        result.data.twoFactorRedirect
      ) {
        const sent = await authClient.twoFactor.sendOtp({ trustDevice: false });
        if (sent.error) throw new Error(sent.error.message);
        setStep("two-factor-code");
        return;
      }

      await enrollPhoneTwoFactor();
      navigateAfterAuth();
    } catch {
      setError("Unable to continue with those credentials. Please try again.");
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
      if (step === "phone-code") {
        const verified = await authClient.phoneNumber.verify({
          code,
          disableSession: false,
          phoneNumber,
          updatePhoneNumber: false,
        });
        if (verified.error) throw new Error(verified.error.message);
        await enrollPhoneTwoFactor();
      } else {
        const verified = await authClient.twoFactor.verifyOtp({
          code,
          trustDevice: false,
        });
        if (verified.error) throw new Error(verified.error.message);
      }
      navigateAfterAuth();
    } catch {
      setError(
        "That code could not be verified. Request a new code and try again."
      );
    } finally {
      setLoading(false);
    }
  }

  async function enrollPhoneTwoFactor() {
    const response = await fetch("/api/auth/enroll-phone-2fa", {
      body: JSON.stringify({ password }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    if (!response.ok) throw new Error("Two-factor enrollment failed.");
  }

  function navigateAfterAuth() {
    window.location.assign(callbackUrl);
  }

  if (step !== "details") {
    return (
      <form className="mt-6 space-y-4" onSubmit={submitCode}>
        <p className="type-supporting-body text-muted-foreground">
          Enter the six-digit code sent to the phone number ending in{" "}
          {phoneNumber.slice(-4)}.
        </p>
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
            setStep("details");
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
      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input
          autoComplete={creatingAccount ? "new-password" : "current-password"}
          id="password"
          minLength={12}
          onChange={(event) => setPassword(event.target.value)}
          required
          type="password"
          value={password}
        />
      </div>
      {error ? (
        <p className="type-supporting-body text-destructive">{error}</p>
      ) : null}
      <Button className="w-full" disabled={loading} type="submit">
        {loading
          ? "Continuing…"
          : creatingAccount
            ? "Create account"
            : "Continue"}
      </Button>
      <Button
        className="w-full"
        disabled={loading}
        onClick={() => {
          setCreatingAccount((value) => !value);
          setError(undefined);
        }}
        type="button"
        variant="ghost"
      >
        {creatingAccount ? "I already have an account" : "Create an account"}
      </Button>
    </form>
  );
}
