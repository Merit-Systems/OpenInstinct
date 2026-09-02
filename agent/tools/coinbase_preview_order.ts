import { defineTool } from "eve/tools";
import { requireCoinbaseAccess } from "../lib/coinbase-access";
import { coinbaseCredentials } from "../lib/coinbase-cli";
import { callCoinbaseMcpTool } from "../lib/coinbase-mcp";
import {
  coinbaseOrderSchema,
  createOrderPreviewToken,
  orderPreviewMcpInput,
} from "../lib/coinbase-order";

export default defineTool({
  description:
    "Preview one exact Coinbase spot or US futures order without executing it. Returns Coinbase's estimate plus a thirty-minute token required by coinbase_create_order. Equities do not support preview; use coinbase_create_equity_order instead.",
  inputSchema: coinbaseOrderSchema,
  async execute(input, ctx) {
    const principalId = requireCoinbaseAccess(ctx);
    const product = await callCoinbaseMcpTool(
      "coinbase_products_get",
      { product_id: input.productId },
      ctx.abortSignal
    );
    assertTradableProduct(product, input);
    const preview = await callCoinbaseMcpTool(
      "coinbase_orders_preview",
      orderPreviewMcpInput(input),
      ctx.abortSignal
    );
    const authorization = createOrderPreviewToken(
      input,
      principalId,
      coinbaseCredentials().keySecret
    );
    return {
      authorization: {
        expiresAt: authorization.expiresAt,
        previewToken: authorization.token,
      },
      nextStep:
        "Show this exact preview to the user. Call coinbase_create_order with the unchanged fields; its durable approval control is the user's authorization.",
      order: input,
      preview,
    };
  },
});

function assertTradableProduct(
  value: unknown,
  order: Parameters<typeof orderPreviewMcpInput>[0]
) {
  const productType = nestedString(value, "product_type")?.toUpperCase();
  const status = nestedString(value, "status")?.toUpperCase();
  if (!productType || !["SPOT", "FUTURE", "EQUITY"].includes(productType)) {
    throw new Error("Coinbase returned an unsupported product type.");
  }
  if (productType === "EQUITY") {
    throw new Error(
      "Coinbase does not support equity previews. Use coinbase_create_equity_order, whose durable approval shows the exact order."
    );
  }
  if (status && status !== "ONLINE") {
    throw new Error("The requested Coinbase product is not online.");
  }
  if (productType === "SPOT" && order.type === "market") {
    if (order.side === "BUY" && !order.quoteSize) {
      throw new Error("A spot market BUY requires quoteSize.");
    }
    if (order.side === "SELL" && !order.baseSize) {
      throw new Error("A spot market SELL requires baseSize.");
    }
  }
  if (productType === "FUTURE" && order.type === "market" && !order.baseSize) {
    throw new Error("A futures market order requires baseSize in contracts.");
  }
}

function nestedString(
  value: unknown,
  key: string,
  depth = 0
): string | undefined {
  if (!value || typeof value !== "object" || depth > 3) return undefined;
  const direct: unknown = Reflect.get(value, key);
  if (typeof direct === "string" && direct) return direct;
  for (const wrapper of ["order", "product", "result"]) {
    const nested = nestedString(Reflect.get(value, wrapper), key, depth + 1);
    if (nested) return nested;
  }
  return undefined;
}
