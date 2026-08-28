# Render Instance-Lock Hardening

## What changed

- Every boot gets a unique lock owner (`pid + timestamp + UUID`), even when `INSTANCE_ID` is configured identically in Render.
- MongoDB lock claims remain atomic and now include a unique `lockToken`.
- Heartbeats are ownership-scoped by both owner and token.
- Overlapping heartbeat requests are prevented.
- Losing the lock immediately disables the execution core and pauses trading (fail-closed).
- Heartbeat failures pause trading before the lock can become stale.
- Graceful release can only clear the lock when both owner and token still match.
- Default stale timeout is 30 seconds; default heartbeat interval is 5 seconds.
- Retry budget automatically covers the complete stale window.

## Render environment

Set these variables on the Render service:

```text
LOCK_STALE_AFTER_MS=30000
LOCK_HEARTBEAT_INTERVAL_MS=5000
LOCK_ACQUIRE_RETRIES=30
LOCK_ACQUIRE_RETRY_DELAY_MS=2000
```

If Render currently contains `LOCK_STALE_AFTER_MS=300000`, the explicit Render variable overrides the code default and must be changed to `30000`.

## Validation

- `node --check trading-bot-v24.6-runtime.mjs`
- `node --check trading-bot-v25.js`
- `node tests/instance-lock-hardening.test.js`

No live-order execution was added or enabled by this change.
