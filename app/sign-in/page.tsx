import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/ui/logo";
import { getDeploymentMode } from "@/lib/deployment-mode";

export default async function SignInPage() {
  if (getDeploymentMode() === "local") redirect("/");
  if ((await auth())?.user) redirect("/");

  return (
    <main className="flex min-h-svh items-center justify-center bg-background px-4 text-foreground">
      <section className="w-full max-w-sm border-y border-border py-8">
        <Logo className="size-9" />
        <h1 className="type-page-title mt-6">Sign in to your workspace</h1>
        <p className="type-supporting-body mt-2 text-muted-foreground">
          Your conversations, connections, and vault stay isolated from every
          other account.
        </p>
        <form
          action={async () => {
            "use server";
            await signIn("github", { redirectTo: "/" });
          }}
          className="mt-6"
        >
          <Button className="w-full" type="submit">
            Continue with GitHub
          </Button>
        </form>
      </section>
    </main>
  );
}
