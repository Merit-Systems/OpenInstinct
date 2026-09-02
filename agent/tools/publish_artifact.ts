import { defineTool } from "eve/tools";
import { scopeFromPrincipal } from "@/lib/access-scope";
import {
  publishArtifact,
  publishArtifactInputSchema,
} from "@/lib/artifacts/server";
import { applicationOrigin } from "@/lib/application-origin";

export default defineTool({
  description:
    "Publish a visual artifact at an unguessable public capability URL. Use HTML for a self-contained interactive mini app, or publish an HTTPS URL for an image, audio, video, PDF, file, or website. Return the artifact marker exactly in the final response so chat and messaging channels render or link it inline.",
  inputSchema: publishArtifactInputSchema,
  async execute(input, ctx) {
    const caller = ctx.session.auth.current ?? ctx.session.auth.initiator;
    if (caller?.principalType !== "user") {
      throw new Error(
        "An authenticated user is required to publish artifacts."
      );
    }
    const published = await publishArtifact(scopeFromPrincipal(caller), input);
    const result = {
      ...published,
      publicUrl: new URL(published.url, applicationOrigin()).toString(),
    };
    if (input.kind === "html") return result;
    return { ...result, sourceUrl: input.sourceUrl };
  },
});
