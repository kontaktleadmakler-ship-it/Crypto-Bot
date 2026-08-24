# PHASE B12 – Persistent Execution Replay

## Added modules
- execution-journal.js
- execution-replay-engine.js
- state-checkpoint-manager.js

## Startup sequence
1. Load latest checkpoint.
2. Replay execution journal after checkpoint timestamp.
3. Compare with exchange reconciliation.
4. Fail closed on mismatch.
5. Resume signal engine only when parity=true.

## Guarantees
- Crash-safe replay.
- Deterministic state rebuild.
- Restart idempotency.
- Audit-complete execution history.
