"use client";

import { CheckCircleIcon, ShieldCheckIcon } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type CheckoutVariant = "heuristic" | "iframe" | "standard";

export function DebugCheckout({
  variant,
}: {
  readonly variant: CheckoutVariant;
}) {
  const [submitted, setSubmitted] = useState(false);

  return (
    <main className="min-h-dvh bg-muted/30 px-4 py-8 text-foreground sm:py-12">
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Badge variant="warning">Development fixture</Badge>
              <span className="type-caption text-muted-foreground">
                No network submission
              </span>
            </div>
            <h1 className="mt-3 text-3xl font-medium tracking-tight">
              Autofill checkout lab
            </h1>
            <p className="type-supporting-body mt-1 text-muted-foreground">
              A safe merchant-shaped surface for inspecting and filling the
              synthetic Visa ending in 4242.
            </p>
          </div>
          <Link
            className={buttonVariants({ variant: "outline" })}
            href="/debug-chat"
          >
            Open raw debug chat
          </Link>
        </header>

        <nav className="flex flex-wrap gap-2" aria-label="Checkout variants">
          {(
            [
              ["standard", "Standards"],
              ["heuristic", "Heuristics"],
              ["iframe", "Iframe"],
            ] as const
          ).map(([id, label]) => (
            <Link
              className={buttonVariants({
                size: "sm",
                variant: variant === id ? "default" : "outline",
              })}
              href={`/debug-checkout?variant=${id}`}
              key={id}
            >
              {label}
            </Link>
          ))}
        </nav>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <Card>
            <CardHeader>
              <CardTitle>Payment details</CardTitle>
              <CardDescription>{variantDescription(variant)}</CardDescription>
            </CardHeader>
            <CardContent>
              <form
                className="space-y-5"
                onSubmit={(event) => {
                  event.preventDefault();
                  setSubmitted(true);
                }}
              >
                {variant === "iframe" ? (
                  <iframe
                    className="h-[390px] w-full rounded-lg border bg-background"
                    sandbox="allow-same-origin"
                    src="/debug-checkout/card-frame"
                    title="Embedded payment fields"
                  />
                ) : (
                  <DebugCardFields heuristic={variant === "heuristic"} />
                )}
                <Button className="w-full" size="lg" type="submit">
                  Test checkout · $12.00
                </Button>
                {submitted ? (
                  <output className="flex items-start gap-2 rounded-lg border border-success-border bg-success-subtle p-3 text-success">
                    <CheckCircleIcon className="mt-0.5 size-4 shrink-0" />
                    <p className="text-sm">
                      Submission intercepted locally. No payment or network
                      request was made.
                    </p>
                  </output>
                ) : null}
              </form>
            </CardContent>
          </Card>

          <aside className="space-y-4">
            <Card variant="muted">
              <CardHeader>
                <CardTitle>Order summary</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="type-supporting-body flex justify-between">
                  <span>Autofill test widget</span>
                  <span>$10.00</span>
                </div>
                <div className="type-supporting-body flex justify-between text-muted-foreground">
                  <span>Sandbox fee</span>
                  <span>$2.00</span>
                </div>
                <div className="flex justify-between border-t pt-3 type-label">
                  <span>Total</span>
                  <span>$12.00</span>
                </div>
              </CardContent>
            </Card>
            <div className="flex gap-3 rounded-xl border bg-background p-4">
              <ShieldCheckIcon className="size-5 shrink-0 text-success" />
              <p className="type-supporting-body text-muted-foreground">
                The fixture prevents form submission and uses only Stripe’s
                non-chargeable test number.
              </p>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}

export function DebugCardFields({
  framed = false,
  heuristic = false,
}: {
  readonly framed?: boolean;
  readonly heuristic?: boolean;
}) {
  const autoComplete = (token: string) => (heuristic ? "off" : token);

  return (
    <div className={cn("space-y-4", framed && "rounded-lg bg-background")}>
      {framed ? (
        <div className="mb-4">
          <Badge variant="information">Same-origin iframe</Badge>
          <p className="mt-2 type-caption text-muted-foreground">
            Exercises all-frame content-script discovery and fill routing.
          </p>
        </div>
      ) : null}
      <Field label="Name on card" htmlFor="cardholder-name">
        <Input
          autoComplete={autoComplete("cc-name")}
          id="cardholder-name"
          name={heuristic ? "cardholder" : "cardholder-name"}
          placeholder="Ada Lovelace"
        />
      </Field>
      <Field label="Card number" htmlFor="payment-number">
        <Input
          autoComplete={autoComplete("cc-number")}
          id="payment-number"
          inputMode="numeric"
          name={heuristic ? "credit_card_number" : "card-number"}
          placeholder="1234 1234 1234 1234"
        />
      </Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Exp. month" htmlFor="expiration-month">
          <select
            autoComplete={autoComplete("cc-exp-month")}
            className="type-input h-8 w-full rounded-lg border border-input bg-transparent px-2.5"
            id="expiration-month"
            name={heuristic ? "expiry_month" : "expiration-month"}
          >
            <option value="">MM</option>
            {Array.from({ length: 12 }, (_, index) => {
              const month = String(index + 1).padStart(2, "0");
              return (
                <option key={month} value={month}>
                  {month}
                </option>
              );
            })}
          </select>
        </Field>
        <Field label="Exp. year" htmlFor="expiration-year">
          <select
            autoComplete={autoComplete("cc-exp-year")}
            className="type-input h-8 w-full rounded-lg border border-input bg-transparent px-2.5"
            id="expiration-year"
            name={heuristic ? "expiry_year" : "expiration-year"}
          >
            <option value="">YYYY</option>
            {[2034, 2035, 2036].map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
        </Field>
        <Field label="CVC" htmlFor="security-code">
          <Input
            autoComplete={autoComplete("cc-csc")}
            id="security-code"
            inputMode="numeric"
            name={heuristic ? "cvv" : "security-code"}
            placeholder="123"
          />
        </Field>
      </div>
      <Field label="Billing ZIP" htmlFor="billing-postal-code">
        <Input
          autoComplete={
            heuristic ? "off" : "section-payment billing postal-code"
          }
          id="billing-postal-code"
          inputMode="numeric"
          name={heuristic ? "billing_zip" : "billing-postal-code"}
          placeholder="10001"
        />
      </Field>
    </div>
  );
}

function Field({
  children,
  htmlFor,
  label,
}: {
  readonly children: ReactNode;
  readonly htmlFor: string;
  readonly label: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}

function variantDescription(variant: CheckoutVariant) {
  switch (variant) {
    case "standard":
      return "Browser-standard autocomplete tokens; this should be the deterministic happy path.";
    case "heuristic":
      return "No useful autocomplete metadata; labels and names drive the fallback matcher.";
    case "iframe":
      return "Card controls live in an iframe to exercise frame discovery and routing.";
  }
}
