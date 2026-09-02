import { defineTool } from "eve/tools";
import {
  coinbaseApprovalPolicy,
  requireCoinbaseAccess,
} from "../lib/coinbase-access";
import { callCoinbaseMcpTool } from "../lib/coinbase-mcp";
import {
  clientOrderIdForCall,
  coinbaseEquityOrderSchema,
  orderMcpInput,
} from "../lib/coinbase-order";

export default defineTool({
  description:
    "Create an eligible Coinbase equity order. Coinbase does not support equity previews, so the durable approval control displays and authorizes this exact order before any funds move. Never ask for a second preliminary confirmation.",
  inputSchema: coinbaseEquityOrderSchema,
  approval: coinbaseApprovalPolicy(true),
  async execute(input, ctx) {
    const principalId = requireCoinbaseAccess(ctx);
    const product = await callCoinbaseMcpTool(
      "coinbase_products_get",
      { product_id: input.productId },
      ctx.abortSignal
    );
    assertTradableEquity(product);
    const clientOrderId = clientOrderIdForCall(ctx.callId, principalId);
    const result = await callCoinbaseMcpTool(
      "coinbase_orders_create",
      orderMcpInput(input, clientOrderId),
      ctx.abortSignal
    );
    return {
      clientOrderId,
      note: "The create response is authoritative. Do not retry this equity order automatically if its outcome is ambiguous.",
      result,
    };
  },
});

function assertTradableEquity(value: unknown) {
  const productType = nestedString(value, "product_type")?.toUpperCase();
  const status = nestedString(value, "status")?.toUpperCase();
  if (productType !== "EQUITY") {
    throw new Error("coinbase_create_equity_order requires an EQUITY product.");
  }
  if (status && status !== "ONLINE") {
    throw new Error("The requested Coinbase equity product is not online.");
  }
}

function nestedString(value: unknown, key: string) {
  if (!value || typeof value !== "object") return undefined;
  const direct: unknown = Reflect.get(value, key);
  if (typeof direct === "string") return direct;
  for (const container of ["product", "result", "data"]) {
    const nested: unknown = Reflect.get(value, container);
    if (nested && typeof nested === "object") {
      const candidate: unknown = Reflect.get(nested, key);
      if (typeof candidate === "string") return candidate;
    }
  }
  return undefined;
}
