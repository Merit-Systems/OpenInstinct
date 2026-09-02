import { defineTool } from "eve/tools";
import {
  requireCoinbaseAccess,
  coinbaseApprovalPolicy,
} from "../lib/coinbase-access";
import { coinbaseCredentials } from "../lib/coinbase-cli";
import { callCoinbaseMcpTool } from "../lib/coinbase-mcp";
import {
  clientOrderIdForPreview,
  coinbaseCreateOrderSchema,
  orderMcpInput,
  verifyOrderPreviewToken,
} from "../lib/coinbase-order";

export default defineTool({
  description:
    "Execute an explicitly approved Coinbase spot or US futures order that exactly matches a fresh coinbase_preview_order result. This moves real funds and always requires user approval.",
  inputSchema: coinbaseCreateOrderSchema,
  approval: coinbaseApprovalPolicy(true),
  async execute(input, ctx) {
    const principalId = requireCoinbaseAccess(ctx);
    verifyOrderPreviewToken(
      input.previewToken,
      input,
      principalId,
      coinbaseCredentials().keySecret
    );
    const clientOrderId = clientOrderIdForPreview(input.previewToken);
    const result = await callCoinbaseMcpTool(
      "coinbase_orders_create",
      orderMcpInput(input, clientOrderId),
      ctx.abortSignal
    );
    return {
      clientOrderId,
      note: "The create response is authoritative. Do not fetch or modify the order unless the user asks.",
      result,
    };
  },
});
