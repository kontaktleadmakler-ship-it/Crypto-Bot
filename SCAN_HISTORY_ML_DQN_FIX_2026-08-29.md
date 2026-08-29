# Scan History Dashboard Fix — ML/DQN/Decision fields

## Root cause

`dashboardRecordProductionScanCoin()` is called once per scanned coin, right
after the market-data/indicator gates (trend/ADX/RSI/etc.), and that single
snapshot is what gets written to `dashboardScanHistoryCollection` in MongoDB
and served by `/api/dashboard/scan-history`.

The ML prediction, the institutional agent-suite evaluation, and the DQN
veto-gate all run *after* that point in the scan pipeline — and for any coin
rejected by an earlier gate, they never run at all. As a result, every
persisted scan-history row was missing `mlProbability`, `dqnAction`,
`confidence`, `agentCount`, `riskState` and a real decision reason. The
dashboard's Scan History panel (`dashboard.html`, `renderScanHistory()`)
reads exactly those fields, so it always rendered `ML —% · DQN —` and a
generic gate reason instead of the actual decision.

A second, smaller issue: the live scan loop called `dqnAgent.act(state)`,
which internally computes Q-values, an action name and a model version and
then throws all of that away, returning only a bare action index. So even if
the payload had been wired up, the Q-values/epsilon/model needed for the
dashboard's `Q-VALUES:` line were never available from the live path.

## Fix (`trading-bot-v24.6-runtime.mjs` — the runtime `v25.js` actually
loads via dynamic import)

- Added `dashboardPatchScanRecord(scanRecordEvent, symbol, patch)`: updates
  the in-memory live snapshot (`dashboardLiveCoinSnapshots`) and, if Mongo is
  connected, does a targeted `updateOne({ eventId }, { $set: {...} })` on the
  exact row that `dashboardRecordProductionScanCoin()` just inserted.
- The initial record call's return value is now captured
  (`const scanRecordEvent = dashboardRecordProductionScanCoin(...)`) so later
  pipeline stages can patch that same row.
- Patches added at every point where new information becomes available:
  - After the ML prediction: `mlProbability`, `mlTrained`; on an ML block,
    `finalDecision: 'REJECT'` + a specific `decisionReason`.
  - After the agent-suite evaluation: `agentCount`, `confidence`, `riskState`;
    on a hard block, `finalDecision`/`decisionReason`.
  - Switched `dqnAgent.act(state)` → `dqnAgent.actWithMetadata(state)` (the
    former just calls the latter and discards the metadata, so trading
    behaviour is unchanged) and patched `dqnAction`, `dqnEpsilon`,
    `dqnModel`, `dqnQValues`; on a DQN veto, `finalDecision`/`decisionReason`.
  - On a confirmed signal (after `persistAlertHistoryEntry`): `finalDecision`
    set to the traded direction, `decisionReason: 'SIGNAL_CONFIRMED'`,
    `signalScore`.

## Fix (`dashboard.html`)

`renderScanHistory()` now prefers `payload.finalDecision` /
`payload.decisionReason` (falling back to the old `gateDirection`/
`gateReason` fields for rows written before this fix) so the action badge
and the "WHY" line reflect the real ML/agent/DQN outcome instead of only the
early market-data gate result.

## Not changed

- No trading/risk logic was touched — only observability. `act()` vs
  `actWithMetadata()` return the identical action for the identical state;
  the veto condition (`shouldVetoCandidate` + epsilon roll) is untouched.
- Rows already persisted in MongoDB before this fix are not backfilled; they
  will keep showing `—` for the ML/DQN columns since that data was never
  computed for them. Only newly scanned coins after deploying this fix will
  show the full picture.
