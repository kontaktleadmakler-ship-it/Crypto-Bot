# Dashboard API Connection Fix

This build changes the dashboard into a read-only projection of the production scanner.

## Architecture

KuCoin -> Market Data -> Production Scanner -> SCAN:COIN / dashboard snapshot -> Dashboard

The dashboard must not start an independent KuCoin + ML + DQN + Risk pipeline.

## New endpoint

GET /api/dashboard/state
- reads production scanner snapshots
- optional ?symbol=BTC-USDT
- returns source=production-scanner-snapshot
- returns 503 with DASHBOARD_STATE_UNAVAILABLE when the scanner snapshot is unavailable

## Market overview

The dashboard market overview now consumes scanner snapshots instead of initiating its own KuCoin requests.

## Paper trading

No live execution was enabled by this change.
