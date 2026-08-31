import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { PhoneAuthForm } from "@/app/sign-in/phone-auth-form";
import { Logo } from "@/components/ui/logo";
import { env, localPhoneAuthBypassEnabled } from "@/lib/env";
import { getAuthSession } from "@/auth/session";
import { readLinqOnboardingPhoneNumber } from "@/auth/linq";

export default async function SignInPage({
  searchParams,
}: PageProps<"/sign-in">) {
  if (await getAuthSession(await headers())) redirect("/");

  const callbackValue = (await searchParams).callbackUrl;
  const requestedCallback = Array.isArray(callbackValue)
    ? callbackValue[0]
    : callbackValue;
  const callbackUrl =
    requestedCallback?.startsWith("/") && !requestedCallback.startsWith("//")
      ? requestedCallback
      : "/";
  const linqConfigured = env.LINQ_CONNECTOR !== undefined;
  const linqPhoneNumber =
    localPhoneAuthBypassEnabled || !env.LINQ_CONNECTOR
      ? undefined
      : (env.LINQ_PHONE_NUMBER ??
        (await readLinqOnboardingPhoneNumber(env.LINQ_CONNECTOR)));

  return (
    <main className="flex min-h-svh items-center justify-center bg-background px-4 py-8 text-foreground">
      <section className="w-full max-w-sm">
        <Logo className="size-9" />
        <h1 className="type-page-title mt-6">Sign in</h1>
        <PhoneAuthForm
          callbackUrl={callbackUrl}
          linqConfigured={linqConfigured}
          linqPhoneNumber={linqPhoneNumber}
          skipOtp={localPhoneAuthBypassEnabled}
        />
      </section>
    </main>
  );
}
