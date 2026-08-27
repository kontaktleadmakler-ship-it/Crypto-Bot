
## Verification status
- `npm run check`: PASS.
- Focused consolidation, BTC timestamp, risk facade and legacy hardening tests: PASS.
- Full `npm test`: all executed tests pass except `ml-training-fallback.test.js`, which cannot start in this clean environment because `@tensorflow/tfjs-node` is not installed. `npm install` could not complete before the execution timeout. This is an environment/dependency issue, not a test assertion failure caused by this patch.
- A real network backtest against an identical historical dataset could not be executed from this upload-only environment because no historical OHLCV fixture is included and the backtest fetches KuCoin data. The deterministic timestamp regression test and indicator consolidation checks pass. No numerical performance equivalence is claimed without that dataset.
- `exchange-adapter.js` SHA-256 before/after: `9097af011c695ea595680b0d47a22f86cce7338981fb5855f868a2e3ba9f176d` (unchanged).
