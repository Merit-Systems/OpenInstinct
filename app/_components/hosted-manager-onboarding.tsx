import {
  ArrowRightIcon,
  CloudIcon,
  ExternalLinkIcon,
  LaptopIcon,
  LockKeyholeIcon,
  MessageSquareIcon,
  ShieldCheckIcon,
  TerminalIcon,
} from "lucide-react";
import Link from "next/link";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function HostedManagerOnboarding({
  managerUrl,
}: {
  readonly managerUrl: string;
}) {
  return (
    <main className="flex flex-col gap-10">
      <header className="flex max-w-2xl flex-col items-start gap-4">
        <Badge variant="information">
          <CloudIcon data-icon="inline-start" />
          Hosted companion
        </Badge>
        <div className="space-y-3">
          <h1 className="type-page-title">
            Your private manager lives on your device
          </h1>
          <p className="type-supporting-body max-w-xl text-muted-foreground">
            Use this web app for chat and browser jobs from anywhere. Passwords,
            identity data, and privileged connections stay with the assistant
            running on your computer.
          </p>
        </div>
      </header>

      <Alert variant="information">
        <ShieldCheckIcon />
        <AlertTitle>Hosted-to-device pairing is the next boundary</AlertTitle>
        <AlertDescription>
          Today, hosted chat and the local vault are separate. Open the manager
          on the computer running Local Vault Assistant. A future pairing flow
          will let hosted surfaces request narrow capabilities without receiving
          vault secrets.
        </AlertDescription>
      </Alert>

      <section
        aria-labelledby="choose-surface-heading"
        className="grid gap-4 sm:grid-cols-2"
      >
        <h2 className="sr-only" id="choose-surface-heading">
          Choose a surface
        </h2>
        <Card>
          <CardHeader>
            <CardTitle>Open the local manager</CardTitle>
            <CardDescription>
              Manage credentials, connections, and local inference on this
              device.
            </CardDescription>
            <CardAction>
              <LaptopIcon className="size-5 text-primary" />
            </CardAction>
          </CardHeader>
          <CardContent>
            <a
              className={cn(buttonVariants({ variant: "default" }), "w-full")}
              href={managerUrl}
            >
              Open local manager
              <ExternalLinkIcon />
            </a>
          </CardContent>
          <CardFooter className="type-caption text-muted-foreground">
            Requires Local Vault Assistant to be running on this computer.
          </CardFooter>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Continue in hosted chat</CardTitle>
            <CardDescription>
              Ask questions and run cloud browser tasks without opening the
              local vault.
            </CardDescription>
            <CardAction>
              <MessageSquareIcon className="size-5 text-primary" />
            </CardAction>
          </CardHeader>
          <CardContent>
            <Link
              className={cn(buttonVariants({ variant: "outline" }), "w-full")}
              href="/chat"
            >
              Open hosted chat
              <ArrowRightIcon />
            </Link>
          </CardContent>
          <CardFooter className="type-caption text-muted-foreground">
            Hosted chat cannot access local credentials in the current build.
          </CardFooter>
        </Card>
      </section>

      <section aria-labelledby="install-heading" className="space-y-4">
        <div className="space-y-1">
          <h2 className="type-section-title" id="install-heading">
            Not running locally yet?
          </h2>
          <p className="type-supporting-body text-muted-foreground">
            Install the private runtime, then keep it running while you use the
            manager.
          </p>
        </div>
        <div className="rounded-xl border border-border bg-muted/50 p-4">
          <div className="mb-3 flex items-center gap-2 text-muted-foreground">
            <TerminalIcon className="size-4" />
            <span className="type-label">macOS terminal</span>
          </div>
          <pre className="overflow-x-auto whitespace-pre-wrap">
            <code className="type-compact-code">
              {
                "curl -fsSL https://raw.githubusercontent.com/Merit-Systems/open-instinct/main/install.sh | bash\n~/.local/bin/local-vault-assistant"
              }
            </code>
          </pre>
        </div>
      </section>

      <aside className="border-l-2 border-information-border pl-4">
        <div className="flex items-start gap-3">
          <LockKeyholeIcon className="mt-0.5 size-4 shrink-0 text-information" />
          <div>
            <h2 className="type-label">The intended trust boundary</h2>
            <p className="mt-1 type-supporting-body text-muted-foreground">
              Web and chat surfaces ask the device for a scoped action. The
              device applies policy, uses the credential locally, and returns a
              minimized result. Raw passwords and broad provider tokens do not
              cross that boundary.
            </p>
          </div>
        </div>
      </aside>
    </main>
  );
}
