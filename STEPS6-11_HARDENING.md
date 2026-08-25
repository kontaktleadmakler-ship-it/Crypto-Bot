# Steps 6-11 Hardening

This build extends the fail-closed architecture after Step 5.

## Step 6 — L2 Order Flow
- Uses actual L2 levels and optional trade-level aggressor data.
- Exposes imbalance, aggression/CVD, cancel/add ratio, depth persistence, liquidity withdrawal, sweep, absorption and order lifetime.
- A single wall can never be sufficient directional evidence.
- Candle volume is not mislabeled as true CVD.

## Step 7 — ML Isolation & Governance
- `ml-worker.js` isolates TensorFlow inference in a Worker Thread.
- `ml-worker-client.js` provides timeout/fail-closed inference access.
- `model-governance.js` provides version registration, OOS checks, drift halt and rollback.
- Existing training path remains untouched; runtime migration to the worker must be enabled explicitly after validating latency and startup behavior.

## Step 8 — Chaos Testing
`chaos-suite.js` defines deterministic failure scenarios for exchange, database, process and market-data faults. A failed scenario is treated as a release blocker because it may hide duplicate-order risk.

## Step 9 — Paper Validation
`paper-validation.js` records decision latency, execution latency, model latency, event-loop lag, simulated slippage and reconciliation correctness.

## Step 10 — Shadow Mode
`shadow-governor.js` makes shadow decisions non-executable and compares expected versus actual positions. Any mismatch is observable and does not permit submission.

## Step 11 — Controlled Scaling
`controlled-scaling-gate.js` enforces PAPER → SHADOW → TINY_LIVE → CONTROLLED_LIVE. Live remains disabled by default and cannot be enabled by a normal runtime flag alone.

## Validation
- `state_queue_fix`: PASS
- Step 3 reconciliation: PASS
- Step 4 orderbook: PASS (5 tests)
- Step 5 risk governor: PASS (5 tests)
- Steps 6-11 suite: PASS
