# v24.1 — B13 Execution Replay Suite

Institutional-grade, paper/shadow-only crash recovery and deterministic replay.

## Included
- Append-only JSONL execution journal with sequence numbers and SHA-256 hash chain.
- Versioned checkpoints with integrity verification.
- Deterministic replay of signals, orders, fills, candles, TP, SL and close events.
- Open-position reconstruction and realized P/L accounting.
- Replay hash parity.
- Missing-event and duplicate-fill detection.
- 32 crash/restart scenarios.
- No exchange order execution and no live trading dependency.

## Invariants
1. Journal events are written before state mutation by the caller.
2. Sequence gaps fail replay when sequence verification is enabled.
3. Duplicate fill IDs are ignored during state application and reported by validation.
4. A checkpoint is valid only when its SHA-256 checksum matches its state.
5. Replay is deterministic and network-independent.

## Test
```bash
node tests/b13.test.js
```

## Scope
v24.1 only. B14/B15/B16 are not represented as completed merely because placeholder files existed in the v23 archive.
Target mode remains **Signal → Paper → Shadow**.
