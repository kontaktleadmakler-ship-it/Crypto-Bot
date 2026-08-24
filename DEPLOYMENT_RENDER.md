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

## v24.6 AI/TFJS compatibility hotfix (2026-08-24)
- Runtime is pinned to Node.js 22.x because `@tensorflow/tfjs-node` versions using the affected backend are not compatible with Node.js 23+ where `util.isNullOrUndefined` was removed.
- `.nvmrc` is pinned to Node 22.14.0.
- `package.json` uses `engines.node = 22.x` and pins `@tensorflow/tfjs-node` to 4.22.0.
- Telegram AI commands are registered automatically via the Telegram `setMyCommands` API at startup, including a per-chat command menu for configured `TELEGRAM_CHAT_ID` values.

## Institutional v25 hardening

Use Node 22.x and start with `node trading-bot-v25.js`. Set `API_KEY`, `MODEL_REGISTRY_DIR`, and `AUDIT_TRAIL_FILE`. Keep `LIVE_TRADING_ENABLED=false` and `BACKTEST_API_ENABLED=false` for paper/shadow deployments. Run `npm run check` and `npm test` in CI before deployment.
