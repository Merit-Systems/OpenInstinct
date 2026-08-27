import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { PhoneAuthForm } from "@/app/sign-in/phone-auth-form";
import { Logo } from "@/components/ui/logo";
import { isLocalPhoneAuthBypassEnabled } from "@/lib/env";
import { getAuthSession } from "@/lib/server/auth-session";

export default async function SignInPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ callbackUrl?: string }>;
}) {
  if (await getAuthSession(await headers())) redirect("/");

  const requestedCallback = (await searchParams).callbackUrl;
  const callbackUrl =
    requestedCallback?.startsWith("/") && !requestedCallback.startsWith("//")
      ? requestedCallback
      : "/";

  return (
    <main className="flex min-h-svh items-center justify-center bg-background px-4 text-foreground">
      <section className="w-full max-w-sm">
        <Logo className="size-9" />
        <h1 className="type-page-title mt-6">Sign in</h1>
        <PhoneAuthForm
          callbackUrl={callbackUrl}
          skipOtp={isLocalPhoneAuthBypassEnabled()}
        />
      </section>
    </main>
  );
}
