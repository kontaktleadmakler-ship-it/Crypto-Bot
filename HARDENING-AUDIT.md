# Hardened Trading Bot – P0/P1 Remediation

This build adds reusable hardening primitives for:

- fail-closed pre-trade checks
- per-symbol execution serialization
- durable state outbox semantics
- bounded graceful shutdown
- TensorFlow disposal on exceptional training paths
- macro freshness validation
- order-book freshness/depth validation
- explicit `ws` dependency

## Important

These changes do not magically make a REST/polling/Node.js architecture an HFT venue stack.
Before live capital is enabled, the runtime must wire the new gates and persistence primitives into
the actual execution path and pass end-to-end failure/chaos tests.

Recommended mandatory tests:

1. DB disconnect during stop-loss.
2. DB reconnect with pending state mutations.
3. Two workers attempting the same execution id.
4. Exchange timeout after order submission.
5. Stale order book.
6. Missing macro data.
7. Shutdown during order submission.
8. Shutdown during DB flush.
9. Repeated ML training with forced exceptions.
10. Restart/reconciliation with unknown exchange orders.

Fail-closed rule: missing or stale market/risk/execution state must block new orders.

## P1–P4 implementation added

### P1 Execution Core
- Explicit execution state machine.
- Atomic idempotency reservation primitive.
- Execution event/outbox persistence primitive.

### P2 Distributed Safety
- Monotonic fencing-token lease.
- Fenced critical-write helper.

### P3 Recovery
- Exchange reconciliation engine.
- Startup recovery coordinator for UNKNOWN/SUBMITTING states.

### P4 Failure Validation
- Execution state tests.
- Atomic idempotency test.
- Mandatory chaos/failure scenario specification.

These modules are intentionally isolated so they can be wired into the existing runtime without silently changing exchange behavior.
