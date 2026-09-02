import type { ToolContext } from "eve/tools";
import type { ApprovalContext } from "eve/tools/approval";
import { describe, expect, it, vi } from "vitest";

const callCoinbaseMcpTool = vi.hoisted(() =>
  vi.fn<
    (
      toolName: string,
      input: Record<string, unknown>,
      signal?: AbortSignal
    ) => Promise<unknown>
  >()
);

vi.mock("./coinbase-mcp", () => ({ callCoinbaseMcpTool }));

import coinbaseCreateOrder from "../tools/coinbase_create_order";
import coinbaseCreateEquityOrder from "../tools/coinbase_create_equity_order";
import coinbasePreviewOrder from "../tools/coinbase_preview_order";
import { coinbaseApprovalResponderAllowed } from "./coinbase-access";
import { coinbaseCreateOrderSchema } from "./coinbase-order";

function toolContext(): ToolContext {
  const principal = {
    attributes: {},
    authenticator: "test",
    principalId: "test-user",
    principalType: "user" as const,
  };
  return {
    abortSignal: new AbortController().signal,
    callId: "coinbase-flow-call",
    async getSandbox() {
      throw new Error("No sandbox is available in this test.");
    },
    getSkill() {
      throw new Error("No skills are available in this test.");
    },
    async getToken() {
      throw new Error("No connection tokens are available in this test.");
    },
    requireAuth() {
      throw new Error("No connection authorization is available in this test.");
    },
    session: {
      auth: { current: principal, initiator: principal },
      id: "coinbase-flow-session",
      turn: { id: "coinbase-flow-turn", sequence: 0 },
    },
    toolName: "coinbase_preview_order",
  };
}

function approvalContext(ctx: ToolContext): ApprovalContext {
  return {
    approvedTools: new Set(),
    callId: ctx.callId,
    getSandbox: () => ctx.getSandbox(),
    getSkill: (identifier) => ctx.getSkill(identifier),
    session: ctx.session,
    toolInput: {},
    toolName: "coinbase_create_order",
  };
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    typeof value === "object" && value !== null && Symbol.asyncIterator in value
  );
}

describe("Coinbase approved order flow", () => {
  it("previews and submits a $1 BTC market buy after its owner approves", async () => {
    callCoinbaseMcpTool.mockImplementation(
      async (toolName: string, input: Record<string, unknown>) => {
        if (toolName === "coinbase_products_get") {
          return {
            product_id: "BTC-USD",
            product_type: "SPOT",
            status: "ONLINE",
          };
        }
        if (toolName === "coinbase_orders_preview") {
          return { preview_id: "preview-1", submitted: input };
        }
        if (toolName === "coinbase_orders_create") {
          return { order_id: "order-1", submitted: input };
        }
        throw new Error(`Unexpected Coinbase tool: ${toolName}`);
      }
    );

    const ctx = toolContext();
    const preview = await coinbasePreviewOrder.execute(
      {
        productId: "BTC-USD",
        quoteSize: "1",
        side: "BUY",
        type: "market",
      },
      ctx
    );
    if (isAsyncIterable(preview)) {
      throw new Error("Coinbase preview unexpectedly returned a stream.");
    }

    expect(callCoinbaseMcpTool.mock.calls[1]?.[1]).toEqual({
      product_id: "BTC-USD",
      quote_size: "1",
      side: "BUY",
      type: "market",
    });
    const createInput = coinbaseCreateOrderSchema.parse({
      productId: "BTC-USD",
      quoteSize: "1",
      side: "BUY",
      type: "market",
      previewToken: preview.authorization.previewToken,
    });
    const approval = coinbaseCreateOrder.approval;
    if (typeof approval === "function" || !approval?.response) {
      throw new Error("Coinbase is missing responder authorization.");
    }
    expect(
      await approval.request({
        ...approvalContext(ctx),
        toolInput: createInput,
      })
    ).toBe("user-approval");
    expect(
      coinbaseApprovalResponderAllowed(
        {
          principalId: "test-user",
          principalType: "user",
        },
        {
          principalId: "test-user",
          principalType: "user",
        }
      )
    ).toBe(true);

    const responder = ctx.session.auth.current;
    if (!responder) throw new Error("Test responder is missing.");
    expect(
      await approval.response({
        auth: {
          async getToken() {
            return { token: "unused" };
          },
          requireAuth() {
            throw new Error("unused");
          },
        },
        request: {
          callId: ctx.callId,
          requestId: "request-1",
          toolInput: createInput,
          toolName: "coinbase_create_order",
        },
        responder,
        response: { decision: "approve" },
        session: {
          id: ctx.session.id,
          initiator: ctx.session.auth.initiator,
          turn: ctx.session.turn,
        },
      })
    ).toEqual({ status: "allowed" });

    const created = await coinbaseCreateOrder.execute(createInput, {
      ...ctx,
      toolName: "coinbase_create_order",
    });
    if (isAsyncIterable(created)) {
      throw new Error(
        "Coinbase order creation unexpectedly returned a stream."
      );
    }

    const submittedOrder = callCoinbaseMcpTool.mock.calls[2]?.[1];
    const clientOrderId = submittedOrder?.client_order_id;
    expect(clientOrderId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
    );
    expect(submittedOrder).toEqual({
      client_order_id: clientOrderId,
      product_id: "BTC-USD",
      quote_size: "1",
      side: "BUY",
      type: "market",
    });
    expect(created.result).toMatchObject({ order_id: "order-1" });
  });

  it("creates an exact owner-approved equity order without preview", async () => {
    const callsBeforeEquityOrder = callCoinbaseMcpTool.mock.calls.length;
    callCoinbaseMcpTool.mockImplementation(
      async (toolName: string, input: Record<string, unknown>) => {
        if (toolName === "coinbase_products_get") {
          return {
            product_id: "AAPL-USD",
            product_type: "EQUITY",
            status: "ONLINE",
          };
        }
        if (toolName === "coinbase_orders_create") {
          return { order_id: "equity-order-1", submitted: input };
        }
        throw new Error(`Unexpected Coinbase tool: ${toolName}`);
      }
    );

    const result = await coinbaseCreateEquityOrder.execute(
      {
        baseSize: "1",
        equityTradingSession: "AFTER_HOURS",
        limitPrice: "250",
        productId: "AAPL-USD",
        side: "BUY",
        type: "limit",
      },
      {
        ...toolContext(),
        callId: "equity-call",
        toolName: "coinbase_create_equity_order",
      }
    );
    if (isAsyncIterable(result)) {
      throw new Error("Coinbase equity create unexpectedly returned a stream.");
    }

    const equityCalls = callCoinbaseMcpTool.mock.calls.slice(
      callsBeforeEquityOrder
    );
    expect(equityCalls.map(([toolName]) => toolName)).toEqual([
      "coinbase_products_get",
      "coinbase_orders_create",
    ]);
    expect(equityCalls[1]?.[1]).toMatchObject({
      base_size: "1",
      equity_trading_session: "AFTER_HOURS",
      limit_price: "250",
      product_id: "AAPL-USD",
      side: "BUY",
      type: "limit",
    });
    expect(result.result).toMatchObject({ order_id: "equity-order-1" });
  });
});
