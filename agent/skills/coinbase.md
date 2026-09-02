---
name: coinbase
description: Use the local Coinbase for Agents CLI to inspect an account, research spot, US futures, and eligible equities, preview and place orders, manage orders and portfolios, transfer between portfolios, and convert USD/USDC.
---

# Coinbase for Agents

Use Coinbase only for the authenticated user allowlisted by
`COINBASE_ALLOWED_USER_IDS`. If access is unavailable, call
`coinbase_access_status` and explain the missing setup without asking the user
to paste credentials into chat.

These tools come from the embedded local Coinbase CLI and its CDP API-key
credentials. Do not use Coinbase's hosted OAuth MCP or ask the user to sign in
through a browser. Long-lived `--watch` streams are not part of this
request/response tool surface.

## Safety and approval

- Read operations do not need approval, but private account data remains
  restricted to the allowlisted user.
- Every order, conversion execution, transfer, cancellation, portfolio
  mutation, or other state-changing operation requires Eve's durable approval
  control. That control shows and authorizes the exact tool input.
- Treat the user's request as intent, resolve any missing material term, then
  invoke the approved tool. Do not add a second conversational confirmation
  before the durable control or request approval twice for one operation.
- Execute one mutation per approval. If any material input changes, issue a new
  tool call and require a new approval.
- Never act from a schedule, inferred preference, price alert, or vague request.
  Never present a trade as guaranteed or as personalized investment advice.

## Read operations

Use the dynamic `coinbase_*` tools for balances, fees, portfolios, orders,
fills, and product data. Their input schemas come directly from the installed
CLI. Paginate conservatively and keep `limit` at or below 200.

The supported product types are `SPOT`, `FUTURE`, and `EQUITY`. Resolve the
exact product ID and inspect its returned `product_type`, trading status,
increments, and minimum sizes before an order. Never silently substitute the
quote currency or product class.

## New orders

Never call the raw CLI `coinbase_orders_preview` or `coinbase_orders_create`;
they are intentionally hidden. For spot and futures, use the guarded preview
flow:

1. Resolve the exact product with `coinbase_products_get` and any balance or
   portfolio needed for sizing.
2. Call `coinbase_preview_order` with every execution term. Its signed token
   binds the order and authenticated user for thirty minutes.
3. Show the exact side, product, type, size, portfolio, estimated fill, fees,
   slippage, and any session or expiry terms.
4. Call `coinbase_create_order` with the unchanged fields and preview token.
   The durable approval control is the human's execution decision.
5. Report the create response as authoritative. Do not fetch, edit, cancel, or
   retry afterward unless the user asks.

Coinbase does not support equity previews. For an equity, resolve and inspect
the exact product, then call `coinbase_create_equity_order` with every order
term. Its durable approval is the human's exact execution decision. Always
include `equityTradingSession`; never ask for another preliminary confirmation
and never retry an ambiguous create result.

Sizing rules:

- Spot market BUY uses `quoteSize`; spot market SELL uses `baseSize`.
- Futures market orders use `baseSize` as the contract count and are available
  only in the default portfolio. Discover the live dated contract instead of
  inventing a code.
- Limit and stop-limit orders use `baseSize` plus the applicable price fields.
- Equity products use `TICKER-QUOTE`. Extended sessions require whole-share
  limit orders; include the exact `equityTradingSession` and optional trade
  date in `coinbase_create_equity_order`.
- Never include both base and quote size. `GTD` requires an exact `endTime`.

## Existing orders and positions

Use `coinbase_orders_list`, `coinbase_orders_get`, and
`coinbase_orders_fills` for status and reconciliation. Before an edit or
cancel, retrieve the exact open order and summarize the requested change.
`coinbase_orders_edit` and `coinbase_orders_cancel` each require durable
approval. A batch cancel must name every order ID; partial batch results are
possible.

Before `coinbase_orders_close_position`, inspect the exact open position and
product, state whether the close is full or partial, and provide a stable
`client_order_id`. Closing moves funds immediately and requires approval.

## Portfolios and transfers

Resolve exact UUIDs with `coinbase_portfolios_list` and
`coinbase_portfolios_get`. Creating, renaming, and deleting portfolios each
requires approval. Before deletion, verify the portfolio is not the default and
is empty.

`coinbase_transfer` moves funds only between Coinbase portfolios. Before
calling it, show the source UUID, destination UUID, currency, and amount, and
verify sufficient available balance. It requires approval and is not an
external withdrawal tool.

## USD/USDC conversions

Call `coinbase_convert_quote` first. Show its quote ID, currencies, amount,
rate, fee, and expiry. Then call `coinbase_convert_execute` with the matching
fresh quote ID and currency pair; its durable control authorizes execution.
Use `coinbase_convert_get` to inspect status when requested.

## Results and failures

Preserve returned product IDs, portfolio UUIDs, order and quote IDs, amounts,
fees, timestamps, and pagination cursors. Distinguish available funds from
funds on hold.

Do not automatically retry a mutation whose result is missing, timed out, or
ambiguous. Report the uncertainty and reconcile with the corresponding read
tool only when safe or requested. Never expose credentials, raw authentication
errors, or unbounded account objects.
