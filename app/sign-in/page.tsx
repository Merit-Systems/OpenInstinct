import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { PhoneAuthForm } from "@/app/sign-in/phone-auth-form";
import { getDeploymentMode } from "@/lib/deployment-mode";
import { getHostedAuthSession } from "@/lib/server/auth-session";

export default async function SignInPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ callbackUrl?: string }>;
}) {
  if (getDeploymentMode() === "local") redirect("/");
  if (await getHostedAuthSession(await headers())) redirect("/");

  const requestedCallback = (await searchParams).callbackUrl;
  const callbackUrl =
    requestedCallback?.startsWith("/") && !requestedCallback.startsWith("//")
      ? requestedCallback
      : "/";

  return (
    <main className="flex min-h-svh items-center justify-center bg-background px-4 text-foreground">
      <section className="w-full max-w-sm">
        <h1 className="type-page-title">Sign in</h1>
        <PhoneAuthForm callbackUrl={callbackUrl} />
      </section>
    </main>
  );
}
