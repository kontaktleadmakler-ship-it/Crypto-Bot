# Institutional v25 deployment contract

## Default mode

The deployment is **PAPER/SHADOW ONLY** unless every production gate is explicitly satisfied. Real execution cannot be enabled by changing `DRY_RUN` alone.

Required operational secrets/configuration:

- `API_KEY` — long random secret for the operational API.
- `MODEL_REGISTRY_DIR` or `DQN_REGISTRY_DIR` — persistent model registry.
- `AUDIT_TRAIL_FILE` — persistent append-only audit path.
- `PAPER_EXECUTION_ENABLED=true`.
- `LIVE_TRADING_ENABLED=false` until independent production approval.
- `BACKTEST_API_ENABLED=false` unless an authenticated operator intentionally enables it.

## Startup validation

Run:

```bash
npm ci
npm run check
npm test
npm run readiness
```

`npm run readiness` is intentionally expected to fail in an unconfigured development environment. It should only report `PRODUCTION_ELIGIBLE` after the required secrets, registry and independent validation evidence are present.

## Rollout sequence

1. Backtest with execution parity.
2. Walk-forward + untouched OOS.
3. Monte Carlo / stress testing.
4. Paper execution.
5. Shadow deployment.
6. Reconciliation and crash-recovery drills.
7. Security/operations review.
8. Human approval.
9. Only then consider a live execution adapter.
