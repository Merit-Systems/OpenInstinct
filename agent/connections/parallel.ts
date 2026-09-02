import { defineMcpClientConnection } from "eve/connections";

export default defineMcpClientConnection({
  url: "https://search.parallel.ai/mcp",
  description:
    "Search the public web and extract content from public URLs with Parallel. Find current facts and sources without an API key. Send only public information, never private account data or secrets.",
  tools: { allow: ["web_search", "web_fetch"] },
});
