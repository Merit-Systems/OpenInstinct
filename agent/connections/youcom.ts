import { defineDynamic, defineMcpClientConnection } from "eve/connections";
import { env } from "@shared/environment";

export default defineDynamic({
  events: {
    "session.started": () => {
      const apiKey = env.YOU_API_KEY;
      return apiKey === undefined
        ? null
        : defineMcpClientConnection({
            auth: { getToken: async () => ({ token: apiKey }) },
            description:
              "You.com web search and research: current information, facts, news, and primary sources. Use for public research, source discovery, comparisons, and verifying time-sensitive claims.",
            instanceKey: "youcom",
            url: "https://api.you.com/mcp",
          });
    },
  },
});
