const coinbaseCapabilities = [
  { name: "coinbase_balance", requiresApproval: false },
  { name: "coinbase_convert_execute", requiresApproval: true },
  { name: "coinbase_convert_get", requiresApproval: false },
  { name: "coinbase_convert_quote", requiresApproval: false },
  { name: "coinbase_fees", requiresApproval: false },
  { name: "coinbase_help", requiresApproval: false },
  { name: "coinbase_orders_cancel", requiresApproval: true },
  { name: "coinbase_orders_close_position", requiresApproval: true },
  { name: "coinbase_orders_edit", requiresApproval: true },
  { name: "coinbase_orders_fills", requiresApproval: false },
  { name: "coinbase_orders_get", requiresApproval: false },
  { name: "coinbase_orders_list", requiresApproval: false },
  { name: "coinbase_portfolios_create", requiresApproval: true },
  { name: "coinbase_portfolios_delete", requiresApproval: true },
  { name: "coinbase_portfolios_edit", requiresApproval: true },
  { name: "coinbase_portfolios_get", requiresApproval: false },
  { name: "coinbase_portfolios_list", requiresApproval: false },
  { name: "coinbase_products_best_bid_ask", requiresApproval: false },
  { name: "coinbase_products_book", requiresApproval: false },
  { name: "coinbase_products_candles", requiresApproval: false },
  { name: "coinbase_products_get", requiresApproval: false },
  { name: "coinbase_products_list", requiresApproval: false },
  { name: "coinbase_products_ticker", requiresApproval: false },
  { name: "coinbase_transfer", requiresApproval: true },
] as const;

export const coinbaseAllowedTools = coinbaseCapabilities.map(
  (capability) => capability.name
);

const capabilityPolicy = new Map<string, (typeof coinbaseCapabilities)[number]>(
  coinbaseCapabilities.map((capability) => [capability.name, capability])
);
const supportedProductTypes = new Set(["EQUITY", "FUTURE", "SPOT"]);
const maximumPageItems = 200;

export function coinbaseToolAllowed(toolName: string) {
  return capabilityPolicy.has(toolName);
}

export function coinbaseToolRequiresApproval(toolName: string) {
  return capabilityPolicy.get(toolName)?.requiresApproval ?? false;
}

export function enforceCoinbaseToolInput(
  toolName: string,
  input: Record<string, unknown>
) {
  if (input.limit !== undefined) {
    if (
      typeof input.limit !== "number" ||
      !Number.isInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > maximumPageItems
    ) {
      throw new Error(
        `Coinbase result limits must be integers between 1 and ${String(maximumPageItems)}.`
      );
    }
  }

  if (input.product_type !== undefined) {
    if (
      typeof input.product_type !== "string" ||
      !supportedProductTypes.has(input.product_type.toUpperCase())
    ) {
      throw new Error("Coinbase product type must be SPOT, FUTURE, or EQUITY.");
    }
    input = { ...input, product_type: input.product_type.toUpperCase() };
  }

  if (toolName === "coinbase_orders_cancel") {
    const orderIds = input.order_ids;
    if (
      !Array.isArray(orderIds) ||
      orderIds.length < 1 ||
      orderIds.length > 10 ||
      orderIds.some((value) => typeof value !== "string" || !value.trim())
    ) {
      throw new Error(
        "Coinbase cancellation requires one to ten exact order IDs."
      );
    }
  }

  if (
    toolName === "coinbase_orders_edit" &&
    input.base_size === undefined &&
    input.limit_price === undefined
  ) {
    throw new Error("Coinbase order edits require a new size or limit price.");
  }

  if (toolName === "coinbase_transfer") {
    if (input.from === input.to) {
      throw new Error(
        "Coinbase transfers require different source and destination portfolios."
      );
    }
    if (!positiveDecimal(input.amount)) {
      throw new Error("Coinbase transfer amount must be a positive decimal.");
    }
  }

  return input;
}

function positiveDecimal(value: unknown) {
  return (
    typeof value === "string" &&
    /^(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(value) &&
    Number(value) > 0
  );
}
