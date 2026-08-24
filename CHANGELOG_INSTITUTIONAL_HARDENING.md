# Institutional Hardening — 25.0.0

## Fixed
- Paper execution fees are now charged on **filled** notional, including partial fills.
- Backtest/paper ambiguity is aligned with a conservative intrabar policy: when a bar touches stop and target, stop wins.
- Walk-forward engine now has deterministic `windows()` plus backward-compatible constructor names.
- Model registry now supports atomic writes, candidate/production lifecycle, promotion evidence and rollback.
- Data validation now supports explicit gap tolerance and Unix-second timestamp normalization while remaining fail-closed on forming candles.
- Risk engine exposes a compatibility `evaluate()` API and normalized kill-switch semantics.
- DQN source tests now validate the actual TensorFlow.js dueling implementation.
- Runtime agent inputs no longer use placeholder exposure/OOS/drift values.
- Runtime API is authenticated by default; backtest endpoint is disabled by default.

## Added
- Centralized safety controller.
- Idempotent portfolio-ledger primitive.
- Production readiness gate.
- Explicit live-execution gate: `DRY_RUN=false` alone can never activate real trading.
- Append-only runtime audit initialization.
- Institutional hardening tests, complete test runner, readiness CLI and CI workflow.

## Safety position
The repository remains **PAPER/SHADOW by default**. Passing automated tests is necessary but not sufficient for real-money production. Production still requires independent OOS evidence, live shadow validation, operational/security review, reconciliation drills and human approval.
