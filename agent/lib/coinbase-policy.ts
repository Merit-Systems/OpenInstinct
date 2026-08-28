export const coinbaseReadTools = new Set([
  "coinbase_balance",
  "coinbase_fees",
  "coinbase_help",
  "coinbase_orders_fills",
  "coinbase_orders_get",
  "coinbase_orders_list",
  "coinbase_portfolios_get",
  "coinbase_portfolios_list",
  "coinbase_products_best_bid_ask",
  "coinbase_products_book",
  "coinbase_products_candles",
  "coinbase_products_get",
  "coinbase_products_list",
  "coinbase_products_ticker",
]);

const maximumPageItems = 200;

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
  const productIds = Array.isArray(input.product_ids)
    ? input.product_ids.filter(
        (value): value is string => typeof value === "string"
      )
    : typeof input.product_ids === "string"
      ? input.product_ids.split(",")
      : [];
  const products = [input.product_id, ...productIds];
  if (
    products.some(
      (value) =>
        typeof value === "string" &&
        /(?:^|[-_])(?:PERP|FUT(?:URE)?)(?:$|[-_])/iu.test(value)
    )
  ) {
    throw new Error(
      "OpenInstinct Coinbase access is restricted to spot products."
    );
  }
  if (
    toolName === "coinbase_products_list" ||
    toolName === "coinbase_orders_list" ||
    toolName === "coinbase_fees"
  ) {
    return { ...input, product_type: "SPOT" };
  }
  return input;
}
