import { describe, expect, it } from "vitest";
import {
  clientOrderIdForPreview,
  coinbaseOrderSchema,
  createOrderPreviewToken,
  orderMcpInput,
  verifyOrderPreviewToken,
} from "./coinbase-order";
import { enforceCoinbaseToolInput } from "./coinbase-policy";

describe("Coinbase order safety", () => {
  const order = coinbaseOrderSchema.parse({
    productId: "btc-usd",
    quoteSize: "25.00",
    side: "BUY",
    type: "market",
  });

  it("normalizes and maps a spot market order", () => {
    expect(order.productId).toBe("BTC-USD");
    expect(orderMcpInput(order)).toEqual({
      product_id: "BTC-USD",
      quote_size: "25.00",
      side: "BUY",
      type: "market",
    });
  });

  it("rejects incompatible sizing and derivative products", () => {
    expect(() =>
      coinbaseOrderSchema.parse({
        baseSize: "0.1",
        productId: "BTC-USD",
        quoteSize: "25",
        side: "BUY",
        type: "market",
      })
    ).toThrow();
    expect(() =>
      enforceCoinbaseToolInput("coinbase_products_get", {
        product_id: "BTC-PERP",
      })
    ).toThrow(/spot products/u);
  });

  it("binds a preview token and idempotency id to the exact user and order", () => {
    const { token } = createOrderPreviewToken(order, "user-1", "secret");

    expect(() =>
      verifyOrderPreviewToken(token, order, "user-1", "secret")
    ).not.toThrow();
    expect(() =>
      verifyOrderPreviewToken(token, order, "user-2", "secret")
    ).toThrow(/different authenticated user/u);
    expect(clientOrderIdForPreview(token)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
    );
  });
});
