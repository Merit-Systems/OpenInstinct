---
name: coinbase
description: Use Coinbase for Agents to inspect a private Coinbase portfolio, research spot products, preview trades, and place explicitly approved spot orders.
---

# Coinbase for Agents

Use Coinbase only for the authenticated user allowlisted by `COINBASE_ALLOWED_USER_IDS`. If access is unavailable, call `coinbase_access_status` and explain the missing setup without asking the user to paste credentials into chat.

## Read operations

Use the dynamically exposed `coinbase_*` tools for balances, fees, portfolios, orders, fills, spot products, books, tickers, and candles. Paginate conservatively and keep `limit` at or below 200. OpenInstinct supports spot products only.

## Trading

Never create an order directly from an initial request.

1. Resolve the exact spot product and current product limits.
2. Resolve ambiguous sizing. A market buy uses `quoteSize`; a market sell uses `baseSize`.
3. Call `coinbase_preview_order` with the exact order.
4. Show the user the side, product, order type, size, estimated fill, fees, slippage, and total. Ask for explicit approval.
5. Only after approval, call `coinbase_create_order` with the unchanged fields and fresh preview token. Eve will display its own durable approval control before execution.

Do not claim success until `coinbase_create_order` returns success. If a write times out or fails ambiguously, do not retry; inspect orders only when the user asks.
