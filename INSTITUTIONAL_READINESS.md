# Institutional Readiness Pack

This repository is hardened toward an institutional-grade architecture, but **code alone does not make a trading system institutionally certified**. Production eligibility requires evidence: independent OOS validation, execution reconciliation, operational controls, security review, incident drills, and a signed change-management process.

## Mandatory gates

- Single execution economics model for paper/research paths
- Conservative intrabar policy shared by backtest and paper logic
- Fail-closed centralized safety controller
- Atomic model registry with promotion/rollback history
- API authentication by default
- Deterministic walk-forward window API
- No placeholder OOS/drift/exposure values in agent decisions
- Portfolio ledger primitives with idempotent event IDs
- Production readiness gate that defaults to PAPER_SHADOW_ONLY

## Promotion evidence

A model may only be considered for production after:

1. untouched OOS evaluation across multiple market regimes,
2. fees/slippage/funding/latency parity checks,
3. replay determinism,
4. reconciliation and crash-recovery drills,
5. drawdown/loss/kill-switch tests,
6. security and secret-management review,
7. shadow deployment with stable live metrics,
8. human approval and rollback plan.

The system remains paper/shadow by default.
