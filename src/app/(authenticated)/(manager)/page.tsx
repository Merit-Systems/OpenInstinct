import {
  BotIcon,
  CloudIcon,
  ImageIcon,
  MailIcon,
  MessageSquareIcon,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import {
  getTokenResponse,
  NoValidTokenError,
  UserAuthorizationRequiredError,
} from "@vercel/connect";
import { z } from "zod";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { getGatewayModel } from "@/db/services/settings";
import { env } from "@/lib/env";
import { googleWorkspaceTokenParams } from "@/lib/google-workspace";
import { requireRequestScope } from "@/lib/request-scope";
import { GoogleWorkspaceAction } from "./_components/google-workspace-action";
import { ModelSelector } from "./_components/model-selector";

export default async function Page({ searchParams }: PageProps<"/">) {
  const google = (await searchParams).google;
  const scope = await requireRequestScope();
  const [googleWorkspace, gatewayModel] = await Promise.all([
    readGoogleWorkspaceConnection(scope.userId),
    getGatewayModel(scope),
  ]);
  const browserReady = true;
  const imageStorageReady = Boolean(
    env.BLOB_STORE_ID ?? env.BLOB_READ_WRITE_TOKEN
  );

  return (
    <div className="mx-auto flex w-full max-w-4xl min-w-0 flex-col gap-8 px-4 py-6 sm:px-6 sm:py-8">
      <h1 className="sr-only">Workspace</h1>

      {google === "unavailable" ? (
        <Alert>
          <MailIcon />
          <AlertTitle>Google Workspace unavailable</AlertTitle>
          <AlertDescription>
            This deployment does not have a working Google OAuth connector yet.
          </AlertDescription>
        </Alert>
      ) : null}

      <ChannelsSection
        browserReady={browserReady}
        linqConfigured={env.LINQ_CONNECTOR !== undefined}
        linqPhoneNumber={env.LINQ_PHONE_NUMBER}
      />
      <GoogleWorkspaceSection connection={googleWorkspace} />

      <WorkspaceSection headingId="connectors-heading" title="Infrastructure">
        <div className="divide-y divide-border/50 border-y border-border/50">
          <ConnectorRow
            action={
              <span className="type-caption text-muted-foreground">
                {browserReady ? "Connected" : "Unavailable"}
              </span>
            }
            description="Run isolated browsers in your Kernel account."
            icon={<CloudIcon />}
            label="Kernel browser"
          />
          <ConnectorRow
            action={
              <span className="type-caption text-muted-foreground">
                {imageStorageReady ? "Connected" : "Unavailable"}
              </span>
            }
            description={
              imageStorageReady
                ? "Store browser images in a private Vercel Blob store."
                : "Connect a private Vercel Blob store to share browser images."
            }
            icon={<ImageIcon />}
            label="Vercel Blob"
          />
          <ConnectorRow
            action={<ModelSelector modelId={gatewayModel} />}
            description={gatewayModel}
            icon={<BotIcon />}
            label="AI Gateway model"
          />
        </div>
      </WorkspaceSection>
    </div>
  );
}

function GoogleWorkspaceSection({
  connection,
}: {
  readonly connection?: GoogleWorkspaceConnection;
}) {
  const state = connection?.state;
  const description =
    state === "connected"
      ? (connection?.accountLabel ?? "Gmail, Calendar, and Contacts connected.")
      : state === "unavailable"
        ? "Attach a Vercel Connect Google OAuth connector to enable this."
        : "Gmail, Calendar, and Contacts through your Google account.";

  return (
    <WorkspaceSection headingId="connections-heading" title="Connections">
      <div className="divide-y divide-border/50 border-y border-border/50">
        <ConnectorRow
          action={<GoogleWorkspaceAction state={state} />}
          description={description}
          icon={<MailIcon />}
          label="Google Workspace"
        />
      </div>
    </WorkspaceSection>
  );
}

type GoogleWorkspaceConnection = {
  readonly accountLabel: string | null;
  readonly state: "connected" | "disconnected" | "unavailable";
};

async function readGoogleWorkspaceConnection(
  userId: string
): Promise<GoogleWorkspaceConnection> {
  try {
    const response = await getTokenResponse(
      env.GOOGLE_CONNECTOR_UID,
      googleWorkspaceTokenParams(userId),
      { forceRefresh: true }
    );
    const claims = z
      .object({ email: z.string().optional() })
      .safeParse(response.claims);
    return {
      accountLabel:
        response.name ?? (claims.success ? (claims.data.email ?? null) : null),
      state: "connected",
    };
  } catch (error) {
    if (
      error instanceof UserAuthorizationRequiredError ||
      error instanceof NoValidTokenError
    ) {
      return { accountLabel: null, state: "disconnected" };
    }
    return { accountLabel: null, state: "unavailable" };
  }
}

export function ChannelsSection({
  browserReady,
  linqConfigured,
  linqPhoneNumber,
}: {
  readonly browserReady: boolean;
  readonly linqConfigured: boolean;
  readonly linqPhoneNumber?: string;
}) {
  return (
    <WorkspaceSection headingId="channels-heading" title="Channels">
      <div className="grid gap-2 sm:grid-cols-2">
        {browserReady ? (
          <Button
            className="h-11 justify-start"
            nativeButton={false}
            render={<Link href="/chat" />}
            variant="outline"
          >
            <MessageSquareIcon />
            WebChat
          </Button>
        ) : (
          <Button className="h-11 justify-start" disabled variant="outline">
            <MessageSquareIcon />
            WebChat
          </Button>
        )}
        {linqConfigured && linqPhoneNumber ? (
          <Button
            className="h-11 justify-start"
            nativeButton={false}
            render={<a href={`sms:${linqPhoneNumber}`} />}
            variant="outline"
          >
            <MailIcon />
            iMessage
          </Button>
        ) : (
          <Button className="h-11 justify-start" disabled variant="outline">
            <MailIcon />
            iMessage
          </Button>
        )}
      </div>
      <p className="type-caption text-muted-foreground">
        {channelAvailabilityMessage({
          browserReady,
          linqConfigured,
          linqPhoneNumber,
        })}
      </p>
    </WorkspaceSection>
  );
}

function channelAvailabilityMessage({
  browserReady,
  linqConfigured,
  linqPhoneNumber,
}: {
  readonly browserReady: boolean;
  readonly linqConfigured: boolean;
  readonly linqPhoneNumber?: string;
}) {
  return [
    browserReady
      ? "WebChat is ready."
      : "KERNEL_API_KEY is required to enable WebChat.",
    linqConfigured && linqPhoneNumber
      ? `iMessage opens ${linqPhoneNumber}.`
      : linqConfigured
        ? "Linq is connected. Use its assigned line to start an iMessage."
        : "Set up Linq to enable iMessage.",
  ].join(" ");
}

function WorkspaceSection({
  children,
  headingId,
  title,
}: {
  readonly children: ReactNode;
  readonly headingId: string;
  readonly title: string;
}) {
  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <h2 className="type-section-title" id={headingId}>
        {title}
      </h2>
      {children}
    </section>
  );
}

function ConnectorRow({
  action,
  description,
  icon,
  label,
}: {
  readonly action: ReactNode;
  readonly description: string;
  readonly icon: ReactNode;
  readonly label: string;
}) {
  return (
    <div className="flex items-center gap-3 py-4">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-muted/50 text-muted-foreground">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="type-label">{label}</p>
        <p className="truncate type-caption text-muted-foreground">
          {description}
        </p>
      </div>
      {action}
    </div>
  );
}
