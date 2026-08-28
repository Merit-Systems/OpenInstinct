import { defineTool } from "eve/tools";
import { scopeFromPrincipal } from "@/lib/access-scope";
import {
  publishArtifact,
  publishArtifactInputSchema,
} from "@/lib/artifacts/server";

export default defineTool({
  description:
    "Publish a private visual artifact for the current user. Use HTML for a self-contained interactive mini app, or publish an HTTPS URL for an image, audio, video, PDF, file, or website. Return the artifact marker exactly in the final response so chat renders it inline.",
  inputSchema: publishArtifactInputSchema,
  async execute(input, ctx) {
    const caller = ctx.session.auth.current ?? ctx.session.auth.initiator;
    if (caller?.principalType !== "user") {
      throw new Error(
        "An authenticated user is required to publish artifacts."
      );
    }
    return publishArtifact(scopeFromPrincipal(caller), input);
  },
});
