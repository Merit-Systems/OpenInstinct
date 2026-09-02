import { asSchema } from "ai";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { coinbaseApprovalResponderAllowed } from "./coinbase-access";
import { listCoinbaseMcpTools, redactCoinbaseResult } from "./coinbase-mcp";
import {
  clientOrderIdForCall,
  clientOrderIdForPreview,
  coinbaseEquityOrderSchema,
  coinbaseOrderSchema,
  createOrderPreviewToken,
  orderMcpInput,
  orderPreviewMcpInput,
  type CoinbaseOrder,
  verifyOrderPreviewToken,
} from "./coinbase-order";
import {
  coinbaseAllowedTools,
  coinbaseToolRequiresApproval,
  enforceCoinbaseToolInput,
} from "./coinbase-policy";

const jsonObjectSchema = z.record(z.string(), z.unknown());

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

  it("exposes an unambiguous quote-sized market-order schema to Eve", async () => {
    const schema = jsonObjectSchema.parse(
      await asSchema(coinbaseOrderSchema).jsonSchema
    );
    const alternatives = z.array(jsonObjectSchema).parse(schema.anyOf);
    const quoteSizedMarket = alternatives.find((alternative) => {
      const properties = jsonObjectSchema.safeParse(alternative.properties);
      const required = z.array(z.string()).safeParse(alternative.required);
      if (!properties.success || !required.success) return false;
      const type = jsonObjectSchema.safeParse(properties.data.type);
      return (
        type.success &&
        type.data.const === "market" &&
        required.data.includes("quoteSize")
      );
    });
    if (!quoteSizedMarket) {
      throw new Error("Eve is missing the quote-sized market-order variant.");
    }
    const properties = jsonObjectSchema.parse(quoteSizedMarket.properties);
    const required = z.array(z.string()).parse(quoteSizedMarket.required);

    expect(properties.baseSize).toEqual({ not: {} });
    expect(properties.type).toEqual({ const: "market", type: "string" });
    expect(required.toSorted()).toEqual(
      ["productId", "quoteSize", "side", "type"].toSorted()
    );
  });

  it("rejects incompatible sizing", () => {
    expect(() =>
      coinbaseOrderSchema.parse({
        baseSize: "0.1",
        productId: "BTC-USD",
        quoteSize: "25",
        side: "BUY",
        type: "market",
      })
    ).toThrow(/Invalid input/u);
  });

  it("supports futures and equity order fields from the local CLI", () => {
    const future = coinbaseOrderSchema.parse({
      baseSize: "1",
      productId: "BIT-28AUG26-CDE",
      side: "BUY",
      type: "market",
    });
    expect(orderPreviewMcpInput(future)).toEqual({
      base_size: "1",
      product_id: "BIT-28AUG26-CDE",
      side: "BUY",
      type: "market",
    });

    const equity = coinbaseEquityOrderSchema.parse({
      baseSize: "2",
      equityOrderDate: "2026-09-02",
      equityTradingSession: "AFTER_HOURS",
      limitPrice: "250.00",
      portfolioId: "portfolio-1",
      side: "BUY",
      productId: "AAPL-USD",
      type: "limit",
    });
    expect(orderMcpInput(equity)).toMatchObject({
      base_size: "2",
      equity_order_date: "2026-09-02",
      equity_trading_session: "AFTER_HOURS",
      limit_price: "250.00",
      portfolio_id: "portfolio-1",
      product_id: "AAPL-USD",
    });
    expect(() =>
      coinbaseEquityOrderSchema.parse({
        baseSize: "2",
        equityTradingSession: "AFTER_HOURS",
        productId: "AAPL-USD",
        side: "BUY",
        type: "market",
      })
    ).toThrow(/whole-share limit order/u);
  });

  it("binds a preview token and idempotency id to the exact user and order", () => {
    const { token } = createOrderPreviewToken(order, "user-1", "secret");
    const changedOrder = {
      productId: "BTC-USD",
      quoteSize: "30.00",
      side: "BUY",
      type: "market",
    } satisfies CoinbaseOrder;

    expect(() => {
      verifyOrderPreviewToken(token, order, "user-1", "secret");
    }).not.toThrow();
    expect(() => {
      verifyOrderPreviewToken(token, order, "user-2", "secret");
    }).toThrow(/different authenticated user/u);
    expect(() => {
      verifyOrderPreviewToken(token, changedOrder, "user-1", "secret");
    }).toThrow(/changed after preview/u);
    expect(clientOrderIdForPreview(token)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
    );
    expect(clientOrderIdForPreview(token)).toBe(clientOrderIdForPreview(token));
    expect(clientOrderIdForCall("call-1", "user-1")).toBe(
      clientOrderIdForCall("call-1", "user-1")
    );
    expect(clientOrderIdForCall("call-1", "user-1")).not.toBe(
      clientOrderIdForCall("call-1", "user-2")
    );
  });

  it("expires preview authorization after thirty minutes", () => {
    const now = new Date("2026-09-02T12:00:00.000Z");
    const date = Date.now;
    Date.now = () => now.valueOf();
    try {
      const { token } = createOrderPreviewToken(order, "user-1", "secret");
      Date.now = () => now.valueOf() + 30 * 60_000 + 1;
      expect(() => {
        verifyOrderPreviewToken(token, order, "user-1", "secret");
      }).toThrow(/expired/u);
    } finally {
      Date.now = date;
    }
  });
});

describe("Coinbase capability policy", () => {
  it("exposes the documented lifecycle, portfolio, and conversion tools", () => {
    expect(coinbaseAllowedTools).toEqual(
      expect.arrayContaining([
        "coinbase_convert_quote",
        "coinbase_convert_execute",
        "coinbase_convert_get",
        "coinbase_orders_edit",
        "coinbase_orders_cancel",
        "coinbase_orders_close_position",
        "coinbase_portfolios_create",
        "coinbase_portfolios_edit",
        "coinbase_portfolios_delete",
        "coinbase_transfer",
      ])
    );
    expect(coinbaseAllowedTools).not.toEqual(
      expect.arrayContaining([
        "coinbase_env",
        "coinbase_set_env",
        "coinbase_orders_create",
        "coinbase_orders_preview",
        "coinbase_x402_pay",
      ])
    );
  });

  it("requires approval for every state-changing capability", () => {
    for (const tool of [
      "coinbase_convert_execute",
      "coinbase_orders_edit",
      "coinbase_orders_cancel",
      "coinbase_orders_close_position",
      "coinbase_portfolios_create",
      "coinbase_portfolios_edit",
      "coinbase_portfolios_delete",
      "coinbase_transfer",
    ]) {
      expect(coinbaseToolRequiresApproval(tool)).toBe(true);
    }
    expect(coinbaseToolRequiresApproval("coinbase_convert_quote")).toBe(false);
  });

  it("allows supported product classes without silently rewriting them", () => {
    expect(
      enforceCoinbaseToolInput("coinbase_products_list", {
        product_type: "EQUITY",
      })
    ).toEqual({ product_type: "EQUITY" });
    expect(
      enforceCoinbaseToolInput("coinbase_orders_list", {
        product_type: "FUTURE",
      })
    ).toEqual({ product_type: "FUTURE" });
    expect(() =>
      enforceCoinbaseToolInput("coinbase_products_list", {
        product_type: "MARGIN",
      })
    ).toThrow(/product type/u);
  });

  it("bounds high-impact native mutation inputs", () => {
    expect(() =>
      enforceCoinbaseToolInput("coinbase_orders_cancel", { order_ids: [] })
    ).toThrow(/one to ten/u);
    expect(() =>
      enforceCoinbaseToolInput("coinbase_orders_edit", {
        order_id: "order-1",
      })
    ).toThrow(/size or limit price/u);
    expect(() =>
      enforceCoinbaseToolInput("coinbase_transfer", {
        amount: "10",
        currency: "USD",
        from: "portfolio-1",
        to: "portfolio-1",
      })
    ).toThrow(/different source and destination/u);
  });

  it("redacts nested credential fields from provider results", () => {
    expect(
      redactCoinbaseResult({
        api_token: "token-value",
        nested: { key_secret: "secret-value", status: "OPEN" },
      })
    ).toEqual({
      api_token: "[credential omitted]",
      nested: { key_secret: "[credential omitted]", status: "OPEN" },
    });
  });

  it("loads the compatible preview contract from the embedded CLI", async () => {
    const definitions = await listCoinbaseMcpTools();
    const preview = definitions.find(
      (definition) => definition.name === "coinbase_orders_preview"
    );

    expect(preview?.inputSchema).toMatchObject({
      properties: {
        base_size: { type: "string" },
        limit_price: { type: "string" },
        product_id: { type: "string" },
        quote_size: { type: "string" },
        side: { enum: ["BUY", "SELL"] },
        type: { enum: ["market", "limit", "stop_limit"] },
      },
      required: ["product_id", "side", "type"],
      type: "object",
    });
  });

  it("accepts approvals only from the allowlisted request owner", () => {
    const allowed = new Set(["user-1"]);
    expect(
      coinbaseApprovalResponderAllowed(
        { principalId: "user-1", principalType: "user" },
        { principalId: "user-1", principalType: "user" },
        allowed
      )
    ).toBe(true);
    expect(
      coinbaseApprovalResponderAllowed(
        { principalId: "user-2", principalType: "user" },
        { principalId: "user-1", principalType: "user" },
        new Set(["user-1", "user-2"])
      )
    ).toBe(false);
    expect(
      coinbaseApprovalResponderAllowed(
        { principalId: "user-1", principalType: "user" },
        { principalId: "user-1", principalType: "runtime" },
        allowed
      )
    ).toBe(false);
    expect(
      coinbaseApprovalResponderAllowed(
        { principalId: "user-1", principalType: "runtime" },
        { principalId: "user-1", principalType: "user" },
        allowed
      )
    ).toBe(false);
  });
});
