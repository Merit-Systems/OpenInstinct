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
} from "@web/components/ai-elements/question";
import { Alert, AlertDescription, AlertTitle } from "@web/components/ui/alert";
import { Button } from "@web/components/ui/button";
import type { InputResponse } from "eve/client";
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
}: {
  readonly canRespond: boolean;
  readonly onInputResponses: RespondToAgentInput;
  readonly part: EveDynamicToolPart;
}) {
  const inputRequest = part.toolMetadata?.eve?.inputRequest;
  if (!inputRequest) return null;

  const inputResponse = part.toolMetadata.eve.inputResponse;
  const selectedOption = inputRequest.options?.find(
    (option) => option.id === inputResponse?.optionId
  );

  return (
    <Alert variant="warning">
      <AlertTitle>{inputRequest.prompt}</AlertTitle>
      <AlertDescription>
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
