import { defineTool } from "eve/tools";
import { requireAgentcashAccess } from "../lib/agentcash-access";
import { callAgentcashMcpTool } from "../lib/agentcash-mcp";
import {
  agentcashFreeFetchSchema,
  agentcashNoPaymentCeilingUsd,
  assertAgentcashFreeSiwxEndpoint,
  safeAgentcashReadInput,
} from "../lib/agentcash-policy";

export default defineTool({
  description:
    "Fetch one HTTPS GET endpoint through Agentcash without payment approval, but only after an immediate schema inspection confirms that the exact GET route uses SIWX and requires no payment. Use this for async pollUrl status checks returned by a previously approved paid request.",
  inputSchema: agentcashFreeFetchSchema,
  async execute(input, ctx) {
    requireAgentcashAccess(ctx);
    const inspectionInput = safeAgentcashReadInput("check_endpoint_schema", {
      headers: input.headers,
      method: "GET",
      url: input.url,
    });
    const inspection = await callAgentcashMcpTool(
      "check_endpoint_schema",
      inspectionInput,
      ctx.abortSignal
    );
    assertAgentcashFreeSiwxEndpoint(inspection, input.url);
    return callAgentcashMcpTool(
      "fetch",
      {
        headers: input.headers,
        maxAmount: agentcashNoPaymentCeilingUsd,
        method: "GET",
        paymentNetwork: input.paymentNetwork,
        paymentProtocol: "x402",
        timeout: input.timeout,
        url: input.url,
      },
      ctx.abortSignal
    );
  },
});
