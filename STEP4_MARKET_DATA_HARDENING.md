# Step 4 — WebSocket / L2 Orderbook Hardening

Implemented safety layer:

`WebSocket → Sequence Validation → Gap Detection → Local Order Book → Freshness → Strategy`

## Safety invariants

- A delta is applied only when `sequenceStart <= lastSequence + 1 <= sequenceEnd`.
- A sequence gap invalidates the local book immediately.
- Gap deltas are never applied.
- Invalid/stale/crossed/empty books are not tradable.
- Recovery requires a fresh sequenced snapshot.
- A REST snapshot without a sequence is explicitly marked `sequenceValidated=false` and is never used to clear a WS gap.
- `MARKET_DATA_REQUIRE_WS=true` makes the runtime fail closed when no sequenced WS book is available.
- `ORDERBOOK_MAX_AGE_MS` controls freshness.

The current exchange adapter remains market-data-only and execution-disabled. No live order capability was added.
