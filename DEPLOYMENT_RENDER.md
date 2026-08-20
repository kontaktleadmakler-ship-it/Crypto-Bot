# Render Deployment – v22.2.1 PRO

The repository must deploy the commit containing this package. Verify Render is not still pinned to an older commit.

Expected build:
- Node.js: >=20 <23
- Build: `npm install`
- Start: `node trading-bot-v22.2.1.js`

Expected startup log:
`🚀 Starte Trading Bot v22.2.1 PRO ...`

Data-quality behavior:
- 15m stale threshold defaults to 20 minutes (`DATA_MAX_AGE_15M_MS`).
- Missing no-tick intervals from KuCoin are tolerated up to the configured ratio (`DATA_MAX_GAP_RATIO_15M`).
- Strict validation remains available through `allowGaps=false` for backtest/data QA callers.

Execution remains fail-closed:
- `EXECUTION_ENABLED=false`
- `DRY_RUN=true`
- `KILL_SWITCH_ENABLED=true`
