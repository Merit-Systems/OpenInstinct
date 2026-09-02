import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod";

const decimalSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/u, "Use a positive decimal string.")
  .refine(
    (value) => Number.isFinite(Number(value)) && Number(value) > 0,
    "Amount must be greater than zero."
  );

const productIdSchema = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase())
  .pipe(
    z
      .string()
      .max(80)
      .regex(/^[A-Z0-9]+(?:-[A-Z0-9]+)+$/u, {
        message:
          "Use an exact Coinbase product ID such as BTC-USD or AAPL-USD.",
      })
  );

const equityTradingSessionSchema = z.enum([
  "NORMAL",
  "PRE_MARKET",
  "AFTER_HOURS",
  "OVERNIGHT",
  "MULTI_SESSION",
]);

const forbiddenOrderField = z.never().optional();
const baseSizeSchema = decimalSchema.describe(
  "Base-asset amount. Use this for market sells, futures contracts, and limit or stop-limit orders."
);
const quoteSizeSchema = decimalSchema.describe(
  "Quote-currency amount to spend. Use this for a spot market buy such as $1 of BTC."
);
const sharedOrderShape = {
  endTime: z.iso.datetime({ offset: true }).optional(),
  portfolioId: z.string().trim().min(1).max(200).optional(),
  productId: productIdSchema.describe(
    "Exact Coinbase product ID, for example BTC-USD."
  ),
  reduceOnly: z.boolean().optional(),
  side: z.enum(["BUY", "SELL"]),
  timeInForce: z.enum(["GTC", "IOC", "FOK", "GTD"]).optional(),
} as const;

const marketQuoteOrderShape = {
  ...sharedOrderShape,
  baseSize: forbiddenOrderField,
  limitPrice: forbiddenOrderField,
  postOnly: forbiddenOrderField,
  quoteSize: quoteSizeSchema,
  stopDirection: forbiddenOrderField,
  stopPrice: forbiddenOrderField,
  type: z.literal("market"),
} as const;

const marketBaseOrderShape = {
  ...sharedOrderShape,
  baseSize: baseSizeSchema,
  limitPrice: forbiddenOrderField,
  postOnly: forbiddenOrderField,
  quoteSize: forbiddenOrderField,
  stopDirection: forbiddenOrderField,
  stopPrice: forbiddenOrderField,
  type: z.literal("market"),
} as const;

const limitOrderShape = {
  ...sharedOrderShape,
  baseSize: baseSizeSchema,
  limitPrice: decimalSchema,
  postOnly: z.boolean().optional(),
  quoteSize: forbiddenOrderField,
  stopDirection: forbiddenOrderField,
  stopPrice: forbiddenOrderField,
  type: z.literal("limit"),
} as const;

const stopLimitOrderShape = {
  ...sharedOrderShape,
  baseSize: baseSizeSchema,
  limitPrice: decimalSchema,
  postOnly: z.boolean().optional(),
  quoteSize: forbiddenOrderField,
  stopDirection: z.enum(["up", "down"]),
  stopPrice: decimalSchema,
  type: z.literal("stop_limit"),
} as const;

function validateOrder(
  value: {
    baseSize?: string;
    endTime?: string;
    equityTradingSession?: z.infer<typeof equityTradingSessionSchema>;
    timeInForce?: "FOK" | "GTC" | "GTD" | "IOC";
    type: "limit" | "market" | "stop_limit";
  },
  ctx: z.RefinementCtx
) {
  if (value.timeInForce === "GTD" && !value.endTime) {
    ctx.addIssue({
      code: "custom",
      message: "A GTD order requires endTime.",
      path: ["endTime"],
    });
  }
  if (value.endTime && value.timeInForce !== "GTD") {
    ctx.addIssue({
      code: "custom",
      message: "endTime is only valid with GTD timeInForce.",
      path: ["endTime"],
    });
  }
  if (
    value.equityTradingSession &&
    value.equityTradingSession !== "NORMAL" &&
    (value.type !== "limit" ||
      !value.baseSize ||
      !Number.isInteger(Number(value.baseSize)))
  ) {
    ctx.addIssue({
      code: "custom",
      message:
        "Extended-hours equity sessions require a whole-share limit order.",
      path: ["equityTradingSession"],
    });
  }
}

export const coinbaseOrderSchema = z
  .union([
    z.object(marketQuoteOrderShape).strict(),
    z.object(marketBaseOrderShape).strict(),
    z.object(limitOrderShape).strict(),
    z.object(stopLimitOrderShape).strict(),
  ])
  .superRefine(validateOrder);

const previewTokenSchema = z.string().min(40).max(4_096);

export const coinbaseCreateOrderSchema = z
  .union([
    z
      .object({ ...marketQuoteOrderShape, previewToken: previewTokenSchema })
      .strict(),
    z
      .object({ ...marketBaseOrderShape, previewToken: previewTokenSchema })
      .strict(),
    z.object({ ...limitOrderShape, previewToken: previewTokenSchema }).strict(),
    z
      .object({ ...stopLimitOrderShape, previewToken: previewTokenSchema })
      .strict(),
  ])
  .superRefine(validateOrder);

export type CoinbaseOrder = z.infer<typeof coinbaseOrderSchema>;

const equityOrderFields = {
  equityOrderDate: z.iso.date().optional(),
  equityTradingSession: equityTradingSessionSchema,
  reduceOnly: forbiddenOrderField,
} as const;

export const coinbaseEquityOrderSchema = z
  .union([
    z.object({ ...marketQuoteOrderShape, ...equityOrderFields }).strict(),
    z.object({ ...marketBaseOrderShape, ...equityOrderFields }).strict(),
    z.object({ ...limitOrderShape, ...equityOrderFields }).strict(),
  ])
  .superRefine(validateOrder);

export type CoinbaseEquityOrder = z.infer<typeof coinbaseEquityOrderSchema>;

const previewPayloadSchema = z.object({
  expiresAtMs: z.number().int().positive(),
  nonce: z.uuid(),
  order: coinbaseOrderSchema,
  principalHash: z.string().regex(/^[a-f0-9]{64}$/u),
  version: z.literal(1),
});

function canonicalOrder(order: CoinbaseOrder): Record<string, unknown> {
  return {
    productId: order.productId,
    side: order.side,
    type: order.type,
    ...(order.quoteSize ? { quoteSize: order.quoteSize } : {}),
    ...(order.baseSize ? { baseSize: order.baseSize } : {}),
    ...(order.limitPrice ? { limitPrice: order.limitPrice } : {}),
    ...(order.stopPrice ? { stopPrice: order.stopPrice } : {}),
    ...(order.stopDirection ? { stopDirection: order.stopDirection } : {}),
    ...(order.postOnly === undefined ? {} : { postOnly: order.postOnly }),
    ...(order.timeInForce ? { timeInForce: order.timeInForce } : {}),
    ...(order.endTime ? { endTime: order.endTime } : {}),
    ...(order.reduceOnly === undefined ? {} : { reduceOnly: order.reduceOnly }),
    ...(order.portfolioId ? { portfolioId: order.portfolioId } : {}),
  };
}

function signature(encoded: string, signingSecret: string) {
  return createHmac("sha256", signingSecret)
    .update("openinstinct-coinbase-order-preview\0")
    .update(encoded)
    .digest();
}

function principalHash(principalId: string) {
  return createHash("sha256")
    .update("openinstinct-coinbase-principal\0")
    .update(principalId)
    .digest("hex");
}

export function createOrderPreviewToken(
  order: CoinbaseOrder,
  principalId: string,
  signingSecret: string
) {
  const expiresAtMs = Date.now() + 30 * 60_000;
  const encoded = Buffer.from(
    JSON.stringify({
      expiresAtMs,
      nonce: randomUUID(),
      order: canonicalOrder(order),
      principalHash: principalHash(principalId),
      version: 1,
    })
  ).toString("base64url");
  return {
    expiresAt: new Date(expiresAtMs).toISOString(),
    token: `${encoded}.${signature(encoded, signingSecret).toString("base64url")}`,
  };
}

export function verifyOrderPreviewToken(
  token: string,
  order: CoinbaseOrder,
  principalId: string,
  signingSecret: string
) {
  const [encoded, suppliedSignature, ...extra] = token.split(".");
  if (!encoded || !suppliedSignature || extra.length > 0) {
    throw new Error("The Coinbase order preview token is malformed.");
  }
  const expected = signature(encoded, signingSecret);
  const supplied = Buffer.from(suppliedSignature, "base64url");
  if (
    supplied.length !== expected.length ||
    !timingSafeEqual(supplied, expected)
  ) {
    throw new Error("The Coinbase order preview token is invalid.");
  }
  let payload: z.infer<typeof previewPayloadSchema>;
  try {
    payload = previewPayloadSchema.parse(
      JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"))
    );
  } catch {
    throw new Error("The Coinbase order preview token is invalid.");
  }
  if (payload.expiresAtMs < Date.now()) {
    throw new Error(
      "The Coinbase order preview expired. Request a fresh preview."
    );
  }
  if (payload.principalHash !== principalHash(principalId)) {
    throw new Error(
      "The Coinbase order preview belongs to a different authenticated user."
    );
  }
  if (
    JSON.stringify(canonicalOrder(payload.order)) !==
    JSON.stringify(canonicalOrder(order))
  ) {
    throw new Error(
      "The order changed after preview. Request a fresh preview."
    );
  }
}

export function clientOrderIdForPreview(token: string) {
  return deterministicClientOrderId("preview", token);
}

export function clientOrderIdForCall(callId: string, principalId: string) {
  return deterministicClientOrderId("call", `${principalId}\0${callId}`);
}

function deterministicClientOrderId(domain: string, value: string) {
  const bytes = createHash("sha256")
    .update(`openinstinct-coinbase-order-${domain}\0`)
    .update(value)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes.readUInt8(6) & 0x0f) | 0x40;
  bytes[8] = (bytes.readUInt8(8) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

export function orderMcpInput(
  order: CoinbaseEquityOrder | CoinbaseOrder,
  clientOrderId?: string
): Record<string, unknown> {
  return {
    ...orderPreviewMcpInput(order),
    ...(order.postOnly === undefined ? {} : { post_only: order.postOnly }),
    ...(order.timeInForce ? { time_in_force: order.timeInForce } : {}),
    ...(order.endTime ? { end_time: order.endTime } : {}),
    ...(order.reduceOnly === undefined
      ? {}
      : { reduce_only: order.reduceOnly }),
    ...(order.portfolioId ? { portfolio_id: order.portfolioId } : {}),
    ...("equityTradingSession" in order
      ? { equity_trading_session: order.equityTradingSession }
      : {}),
    ...("equityOrderDate" in order && order.equityOrderDate
      ? { equity_order_date: order.equityOrderDate }
      : {}),
    ...(clientOrderId ? { client_order_id: clientOrderId } : {}),
  };
}

export function orderPreviewMcpInput(
  order: CoinbaseEquityOrder | CoinbaseOrder
): Record<string, unknown> {
  return {
    product_id: order.productId,
    side: order.side,
    type: order.type,
    ...(order.quoteSize ? { quote_size: order.quoteSize } : {}),
    ...(order.baseSize ? { base_size: order.baseSize } : {}),
    ...(order.limitPrice ? { limit_price: order.limitPrice } : {}),
    ...(order.stopPrice ? { stop_price: order.stopPrice } : {}),
    ...(order.stopDirection ? { stop_direction: order.stopDirection } : {}),
  };
}
