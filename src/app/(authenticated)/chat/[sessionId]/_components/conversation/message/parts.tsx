import type { EveMessagePart } from "eve/react";
import { ExternalLinkIcon } from "lucide-react";
import { MessageResponse } from "@/components/ai-elements/message";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool";
import { AttachmentPart } from "./attachment";
import { parseArtifactMessage } from "@/lib/artifacts";
import { AuthorizationPrompt } from "./authorization";
import { InputRequestActions, QuestionRequest } from "./input-request";
import type { RespondToAgentInput } from "./types";

export function AgentMessagePart({
  canRespond,
  onInputResponses,
  part,
  showCaret,
  userVisibleOnly,
}: {
  readonly canRespond: boolean;
  readonly onInputResponses: RespondToAgentInput;
  readonly part: EveMessagePart;
  readonly showCaret: boolean;
  readonly userVisibleOnly: boolean;
}) {
  switch (part.type) {
    case "step-start":
      return null;
    case "text":
      return <ArtifactMessageText isAnimating={showCaret} text={part.text} />;
    case "reasoning":
      return (
        <Reasoning defaultOpen isStreaming={part.state === "streaming"}>
          <ReasoningTrigger />
          <ReasoningContent>{part.text}</ReasoningContent>
        </Reasoning>
      );
    case "file":
      return <AttachmentPart part={part} />;
    case "authorization":
      return <AuthorizationPrompt part={part} />;
    case "dynamic-tool": {
      const inputRequest = part.toolMetadata?.eve?.inputRequest;
      if (inputRequest?.kind === "question") {
        return (
          <QuestionRequest
            canRespond={canRespond}
            inputRequest={inputRequest}
            inputResponse={part.toolMetadata?.eve?.inputResponse}
            onInputResponses={onInputResponses}
          />
        );
      }

      if (userVisibleOnly && inputRequest) {
        return (
          <InputRequestActions
            canRespond={canRespond}
            part={part}
            onInputResponses={onInputResponses}
          />
        );
      }

      return (
        <Tool
          defaultOpen={
            part.state === "approval-requested" ||
            part.state === "approval-responded"
          }
        >
          <ToolHeader status={part.state} title={part.toolName} />
          <ToolContent>
            <ToolInput input={part.input} />
            <InputRequestActions
              canRespond={canRespond}
              part={part}
              onInputResponses={onInputResponses}
            />
            <ToolOutput errorText={part.errorText} output={part.output} />
          </ToolContent>
        </Tool>
      );
    }
  }
  throw new Error("Unsupported agent message part.");
}

function ArtifactMessageText({
  isAnimating,
  text,
}: {
  readonly isAnimating: boolean;
  readonly text: string;
}) {
  return parseArtifactMessage(text).map((segment, index) =>
    segment.type === "text" ? (
      <MessageResponse
        caret="block"
        isAnimating={isAnimating && index === 0}
        key={`text:${String(index)}`}
      >
        {segment.text}
      </MessageResponse>
    ) : (
      <div
        className="my-3 overflow-hidden rounded-xl border bg-background shadow-sm"
        key={segment.id}
      >
        <iframe
          className="h-[28rem] w-full bg-background"
          loading="lazy"
          sandbox="allow-forms allow-scripts"
          src={segment.url}
          title="OpenInstinct artifact"
        />
        <div className="flex items-center justify-end border-t px-3 py-2">
          <a
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            href={segment.url}
            rel="noreferrer"
            target="_blank"
          >
            Open artifact
            <ExternalLinkIcon className="size-3.5" />
          </a>
        </div>
      </div>
    )
  );
}

export function partKey(part: EveMessagePart, index: number): string {
  switch (part.type) {
    case "authorization":
      return `authorization:${part.turnId}:${String(part.stepIndex)}:${part.name}`;
    case "dynamic-tool":
      return part.toolCallId;
    default:
      return `${part.type}:${String(index)}`;
  }
}
