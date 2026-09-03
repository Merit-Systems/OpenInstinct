import type { EveDynamicToolPart, EveMessageInputRequest } from "eve/react";
import {
  Question,
  QuestionActions,
  QuestionDescription,
  QuestionInput,
  QuestionOption,
  QuestionOptions,
  QuestionPrompt,
  type QuestionResponse,
  QuestionSubmit,
} from "@/components/ai-elements/question";
import { ToolInput } from "@/components/ai-elements/tool";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { InputResponse } from "eve/client";
import { approvalSummary } from "@/app/(authenticated)/chat/_lib/approval-summary";
import type { RespondToAgentInput } from "./types";

export function QuestionRequest({
  canRespond,
  inputRequest,
  inputResponse,
  onInputResponses,
}: {
  readonly canRespond: boolean;
  readonly inputRequest: EveMessageInputRequest;
  readonly inputResponse?: InputResponse;
  readonly onInputResponses: RespondToAgentInput;
}) {
  const selectedOption = inputRequest.options?.find(
    (option) => option.id === inputResponse?.optionId
  );
  const hasOptions = (inputRequest.options?.length ?? 0) > 0;
  const acceptsFreeform = inputRequest.allowFreeform === true || !hasOptions;

  const submitResponse = ({ selectedValues, text }: QuestionResponse) =>
    onInputResponses([
      {
        optionId: selectedValues[0],
        requestId: inputRequest.requestId,
        text,
      },
    ]);

  return (
    <Question
      defaultValue={{
        selectedValues: inputResponse?.optionId ? [inputResponse.optionId] : [],
        text: inputResponse?.text ?? "",
      }}
      disabled={!canRespond || inputResponse !== undefined}
      onSubmit={submitResponse}
    >
      <QuestionPrompt>{inputRequest.prompt}</QuestionPrompt>
      {hasOptions ? (
        <QuestionOptions
          className="flex-col items-stretch"
          aria-label={inputRequest.prompt}
        >
          {inputRequest.options?.map((option) => (
            <QuestionOption
              className="justify-start text-left"
              key={option.id}
              value={option.id}
            >
              <span>
                <span className="block">{option.label}</span>
                {option.description ? (
                  <span className="block type-caption opacity-70">
                    {option.description}
                  </span>
                ) : null}
              </span>
            </QuestionOption>
          ))}
        </QuestionOptions>
      ) : null}
      {acceptsFreeform ? (
        <QuestionInput aria-label="Answer" placeholder="Type your answer…" />
      ) : null}
      {inputResponse ? (
        <QuestionDescription>
          Responded:{" "}
          {selectedOption?.label ??
            inputResponse.text ??
            inputResponse.optionId}
        </QuestionDescription>
      ) : (
        <QuestionActions>
          <QuestionSubmit>Answer</QuestionSubmit>
        </QuestionActions>
      )}
    </Question>
  );
}

export function InputRequestActions({
  canRespond,
  onInputResponses,
  part,
  showParameters = false,
}: {
  readonly canRespond: boolean;
  readonly onInputResponses: RespondToAgentInput;
  readonly part: EveDynamicToolPart;
  /** Render the tool parameters inside the control that authorizes them. */
  readonly showParameters?: boolean;
}) {
  const inputRequest = part.toolMetadata?.eve?.inputRequest;
  if (!inputRequest) return null;

  const inputResponse = part.toolMetadata.eve.inputResponse;
  const selectedOption = inputRequest.options?.find(
    (option) => option.id === inputResponse?.optionId
  );
  const summary = approvalSummary(part);

  return (
    <Alert variant="warning">
      <AlertTitle>{inputRequest.prompt}</AlertTitle>
      <AlertDescription>
        {summary ? <p>{summary}</p> : null}
        {showParameters ? <ToolInput input={part.input} /> : null}
        {inputResponse ? (
          <p>
            Responded:{" "}
            {selectedOption?.label ??
              inputResponse.text ??
              inputResponse.optionId}
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {inputRequest.options?.map((option) => (
              <Button
                disabled={!canRespond}
                key={option.id}
                onClick={() => {
                  void onInputResponses([
                    {
                      optionId: option.id,
                      requestId: inputRequest.requestId,
                    },
                  ]);
                }}
                size="sm"
                type="button"
                variant={option.style === "danger" ? "destructive" : "default"}
              >
                {option.label}
              </Button>
            ))}
          </div>
        )}
      </AlertDescription>
    </Alert>
  );
}
