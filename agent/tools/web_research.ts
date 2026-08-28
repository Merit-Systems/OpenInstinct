import { defineDynamic, defineTool } from "eve/tools";
import { z } from "zod";
import { env } from "@/lib/env";

const responseIdSchema = z.string().min(1).regex(/^\S+$/u);

const inputSchema = z.object({
  query: z
    .string()
    .min(1)
    .refine((value) => value.trim().length > 0, "Provide a research question.")
    .refine(
      // Match the API's Unicode code points, not UTF-16 code units.
      (value) => Array.from(value).length <= 20_000,
      "The question must be at most 20,000 characters."
    )
    .describe(
      "The complete public-web question, including dates, units and constraints. No conversation history is sent automatically. Never include secrets or private account data. Maximum 20,000 characters."
    ),
  effort: z
    .enum(["low", "medium", "high"])
    .default("low")
    .describe(
      "Use low for quick facts, medium for comparisons, high for extensive research. Each call is billed by Parallel."
    ),
  previous_response_id: responseIdSchema
    .optional()
    .describe(
      "The response_id returned by this tool in this conversation, only when continuing that investigation. Omit for independent research. Saved context may be unavailable; ZDR accounts cannot use follow-ups."
    ),
});

const responseSchema = z.object({
  status: z.literal("completed"),
  id: z.unknown().optional(),
  output: z.array(
    z.object({
      type: z.string(),
      content: z
        .array(
          z.object({
            type: z.string(),
            text: z.string().optional(),
            annotations: z.array(z.unknown()).optional(),
          })
        )
        .optional(),
    })
  ),
});

const citationSchema = z.object({
  type: z.literal("url_citation"),
  url: z.url({ protocol: /^https?$/u }),
  title: z.string().default(""),
});

function requestFailure(signal: AbortSignal) {
  if (signal.aborted) {
    return new Error(
      signal.reason instanceof DOMException &&
        signal.reason.name === "TimeoutError"
        ? "Parallel research timed out after 120 seconds. It may still complete and be billed; do not retry automatically."
        : "Parallel research was cancelled. It may still complete and be billed; do not retry automatically."
    );
  }
  return new Error(
    "Parallel research could not finish or returned invalid JSON. The request may have been billed; do not retry automatically."
  );
}

function researchResult(value: unknown) {
  const parsed = responseSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      "Parallel returned an invalid or incomplete research response."
    );
  }

  const parts = parsed.data.output
    .filter((item) => item.type === "message")
    .flatMap((item) => {
      if (!item.content)
        throw new Error("Parallel returned a message without content.");
      return item.content;
    })
    .filter((part) => part.type === "output_text");
  if (parts.some((part) => part.text === undefined)) {
    throw new Error("Parallel returned research content without text.");
  }
  // Preserve answer formatting. Citation spans belong to their original text
  // parts, so expose source links instead of remapping offsets into joined text.
  const answer = parts.map((part) => part.text).join("\n\n");
  if (!answer.trim())
    throw new Error("Parallel returned an empty research answer.");

  const sources = new Map<
    string,
    Pick<z.infer<typeof citationSchema>, "url" | "title">
  >();
  for (const part of parts) {
    for (const annotation of part.annotations ?? []) {
      const citation = citationSchema.safeParse(annotation);
      if (!citation.success) continue;
      const { url, title } = citation.data;
      const parsedUrl = new URL(url);
      if (parsedUrl.username || parsedUrl.password) continue;
      if (!sources.has(url)) sources.set(url, { url, title });
    }
  }
  const id = responseIdSchema.safeParse(parsed.data.id);
  return {
    ...(id.success ? { response_id: id.data } : {}),
    answer,
    sources: [...sources.values()],
  };
}

const researchTool = defineTool({
  description:
    "Answer a public-web question using Parallel's paid research API. One call researches sources and returns a synthesized answer with source links, not raw search results. Send the complete question and constraints; no conversation or private account context is sent automatically. Use an explicit previous_response_id only for a follow-up in this conversation. Preserve source links in your answer. Do not automatically retry errors or silently restart failed follow-ups.",
  inputSchema,
  async execute(input, context) {
    // Read credentials at execution time, never into a persisted tool closure.
    const apiKey = env.PARALLEL_API_KEY;
    if (!apiKey)
      throw new Error(
        "Parallel research is not configured. Set PARALLEL_API_KEY on the server."
      );
    const request = inputSchema.safeParse(input);
    if (!request.success) {
      throw new Error(
        "Invalid research input: provide a nonblank question of at most 20,000 characters, a supported effort, and a nonblank response ID when continuing."
      );
    }
    const signal = AbortSignal.any([
      context.abortSignal,
      AbortSignal.timeout(120_000),
    ]);
    if (signal.aborted) throw requestFailure(signal);

    let response: Response;
    let body: unknown;
    try {
      response = await fetch("https://api.parallel.ai/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "parallel",
          input: request.data.query,
          reasoning: { effort: request.data.effort },
          stream: false,
          previous_response_id: request.data.previous_response_id,
        }),
        cache: "no-store",
        redirect: "error",
        signal,
      });
      if (response.ok) body = await response.json();
    } catch {
      // Transport and JSON errors can contain request data. Never return them.
      throw requestFailure(signal);
    }
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined);
      const hint =
        response.status === 401
          ? " Check the server's PARALLEL_API_KEY."
          : response.status === 404 && request.data.previous_response_id
            ? " The previous response is unavailable; do not silently start fresh."
            : "";
      throw new Error(
        `Parallel research failed (HTTP ${String(response.status)}).${hint} This call was not retried.`
      );
    }
    return researchResult(body);
  },
});

function availableResearchTool() {
  return env.PARALLEL_API_KEY ? researchTool : null;
}

export default defineDynamic({
  events: {
    "session.started": availableResearchTool,
    "turn.started": availableResearchTool,
  },
});
