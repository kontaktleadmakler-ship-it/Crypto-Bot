# Runtime integration contract

The runtime execution path must follow:

1. Build signal.
2. Run risk.
3. Validate fresh market data/orderbook.
4. Validate DB health + fencing lease + reconciliation health.
5. Reserve execution ID atomically.
6. Persist `INTENT_CREATED`.
7. Transition to `RISK_APPROVED`.
8. Transition to `IDEMPOTENCY_RESERVED`.
9. Transition to `ORDER_SUBMITTING`.
10. Call exactly one exchange submitter.
11. On normal response -> `ACKNOWLEDGED` / `PARTIALLY_FILLED` / `FILLED`.
12. On ambiguous timeout/network failure -> `UNKNOWN`.
13. Never retry `UNKNOWN` by calling submit again.
14. Reconcile with exchange.
15. Persist fills/position/ledger.
16. Only then mark the execution reconciled.

A direct call to `exchange.placeOrder()` outside this path should be treated as a code-review failure.
