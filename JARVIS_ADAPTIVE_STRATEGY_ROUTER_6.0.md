# JARVIS 6.0 — Adaptive Strategy Router

## Purpose
Read-only, regime-conditioned strategy weighting recommendation for the JARVIS dashboard.

## Inputs
- Current agent scores/status from the existing agent network
- Historical agent performance from recorded decision events
- Current regime classification
- Current final action / supervisor state

## Outputs
- Regime
- Recommended action (or BLOCK when a live veto exists)
- Confidence
- Per-agent recommended weights
- Historical hit rate / average return
- Live agent score
- Conflicts and rationale

## Governance
- No order submission
- No execution-state mutation
- No production model promotion
- No strategy configuration mutation
- Dashboard endpoint is read-only

Endpoint:
`/api/dashboard/adaptive-router`
