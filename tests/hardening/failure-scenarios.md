# Mandatory P1–P4 failure scenarios

## P1 Execution
- Exchange accepts order, response times out -> state MUST become UNKNOWN.
- UNKNOWN MUST NOT issue a second order.
- Reconciliation finds FILLED -> ledger/state becomes FILLED exactly once.
- Duplicate execution ID -> exactly one reservation wins.

## P2 Fencing
- Worker A gets token 10.
- Worker B takes over and gets token 11.
- Worker A attempts a critical write -> MUST be rejected.
- Lease renewal with stale token -> MUST fail.

## P3 Recovery
- Restart with ORDER_SUBMITTING/UNKNOWN executions.
- Recovery MUST reconcile before allowing new risk-taking.
- Position mismatch -> global trading halt.

## P4 Chaos
- Mongo disconnect during stop loss.
- Mongo reconnect with queued mutations.
- WebSocket disconnect and sequence gap.
- Exchange 429/5xx/timeout.
- SIGTERM during order submit.
- SIGTERM during persistence flush.
- Process crash after exchange acknowledgement but before local persistence.
- Stale market data.
- Stale macro data.

Every failure mode defaults to BLOCK/HALT, never to a new order.
