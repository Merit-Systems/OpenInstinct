import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { PhoneAuthForm } from "@/app/sign-in/phone-auth-form";
import { Logo } from "@/components/ui/logo";
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
      <section className="w-full max-w-sm border-y border-border py-8">
        <Logo className="size-9" />
        <h1 className="type-page-title mt-6">Sign in to your workspace</h1>
        <p className="type-supporting-body mt-2 text-muted-foreground">
          Your conversations, connections, and vault stay isolated from every
          other account.
        </p>
        <PhoneAuthForm callbackUrl={callbackUrl} />
      </section>
    </main>
  );
}
