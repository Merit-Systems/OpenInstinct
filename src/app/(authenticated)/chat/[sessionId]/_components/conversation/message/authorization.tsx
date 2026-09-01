import type { EveAuthorizationPart } from "eve/react";
import {
  CheckCircleIcon,
  ExternalLinkIcon,
  KeyRoundIcon,
  XCircleIcon,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export function AuthorizationPrompt({
  part,
}: {
  readonly part: EveAuthorizationPart;
}) {
  const isAuthorized =
    part.state === "completed" && part.outcome === "authorized";
  const isCompleted = part.state === "completed";
  const Icon = isAuthorized
    ? CheckCircleIcon
    : isCompleted
      ? XCircleIcon
      : KeyRoundIcon;
  const instructions = part.authorization?.instructions;
  const shouldShowInstructions =
    instructions !== undefined && instructions !== part.description;
  const alertVariant = isAuthorized
    ? "success"
    : isCompleted
      ? "destructive"
      : "information";

  return (
    <Alert variant={alertVariant}>
      <Icon />
      <AlertTitle>{authorizationTitle(part)}</AlertTitle>
      <AlertDescription>
        <p>{authorizationDescription(part)}</p>
        {shouldShowInstructions ? <p>{instructions}</p> : null}
        {part.state === "required" && part.authorization?.userCode ? (
          <div className="flex flex-wrap items-center gap-2">
            <span>Code</span>
            <Badge variant="outline">
              <code className="type-compact-code">
                {part.authorization.userCode}
              </code>
            </Badge>
          </div>
        ) : null}
        {part.state === "required" && part.authorization?.url ? (
          <Button
            render={
              <a
                aria-label={`Sign in with ${part.displayName}`}
                href={part.authorization.url}
                rel="noreferrer"
                target="_blank"
              />
            }
            size="sm"
          >
            <ExternalLinkIcon />
            Sign in with {part.displayName}
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}

function authorizationTitle(part: EveAuthorizationPart): string {
  if (part.state === "required") return `Connect ${part.displayName}`;
  if (part.outcome === "authorized") return `${part.displayName} connected`;
  return `${part.displayName} authorization ${formatAuthorizationOutcome(part.outcome)}`;
}

function authorizationDescription(part: EveAuthorizationPart): string {
  if (part.state === "required") return part.description;
  if (part.outcome === "authorized") return `${part.displayName} connected.`;
  const tail = part.reason !== undefined ? ` (${part.reason})` : "";
  return `${part.displayName} authorization ${formatAuthorizationOutcome(part.outcome)}${tail}.`;
}

function formatAuthorizationOutcome(
  outcome: NonNullable<EveAuthorizationPart["outcome"]>
): string {
  switch (outcome) {
    case "authorized":
      return "authorized";
    case "declined":
      return "declined";
    case "failed":
      return "failed";
    case "timed-out":
      return "timed out";
  }
  throw new Error("Unsupported authorization outcome.");
}
