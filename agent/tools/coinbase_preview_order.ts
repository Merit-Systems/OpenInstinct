import { defineTool } from "eve/tools";
import { requireCoinbaseAccess } from "../lib/coinbase-access";
import { coinbaseCredentials } from "../lib/coinbase-cli";
import { callCoinbaseMcpTool } from "../lib/coinbase-mcp";
import {
  coinbaseOrderSchema,
  createOrderPreviewToken,
  orderMcpInput,
} from "../lib/coinbase-order";

export default defineTool({
  description:
    "Preview one exact Coinbase spot order without executing it. Returns Coinbase's estimate plus a five-minute token required by coinbase_create_order.",
  inputSchema: coinbaseOrderSchema,
  async execute(input, ctx) {
    const principalId = requireCoinbaseAccess(ctx);
    const product = await callCoinbaseMcpTool(
      "coinbase_products_get",
      { product_id: input.productId },
      ctx.abortSignal
    );
    assertTradableSpotProduct(product);
    const preview = await callCoinbaseMcpTool(
      "coinbase_orders_preview",
      orderMcpInput(input),
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
        "Show this exact preview to the user. Call coinbase_create_order only after explicit approval of the unchanged order.",
      order: input,
      preview,
    };
  },
});

function assertTradableSpotProduct(value: unknown) {
  const productType = nestedString(value, "product_type")?.toUpperCase();
  const status = nestedString(value, "status")?.toUpperCase();
  if (productType !== "SPOT") {
    throw new Error("OpenInstinct is restricted to Coinbase spot products.");
  }
  if (status && status !== "ONLINE") {
    throw new Error("The requested Coinbase spot product is not online.");
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
