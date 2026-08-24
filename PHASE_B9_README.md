# v22.5 – Phase B9: WebSocket + Data Recording + Replay

## Added

- `market-data-websocket.js`: reconnecting market-data-only WebSocket abstraction.
- `market-data-recorder.js`: append-only JSONL market-event recording.
- `market-data-replay.js`: chronological deterministic replay.
- `market-data-config.js`: conservative feature flags.
- `tests/b9.test.js`

## Safety

B9 does not add order execution. WebSocket is market-data only.
`MARKET_WS_ENABLED=false` by default.

## Environment

- `MARKET_WS_ENABLED=false`
- `MARKET_WS_URL=`
- `MARKET_DATA_RECORDING=true`
- `MARKET_DATA_DIR=./data/market-replay`
- `MARKET_REPLAY_SPEED=0` (as-fast-as-possible replay)
- `MARKET_WS_RECONNECT_MAX_MS=30000`

## Important

The recorder stores raw/normalized market events for reproducible replay.
The replay sorts by event timestamp and never emits an event before its
recorded timestamp in the replay sequence.

This package adds the B9 foundation without changing live signal logic.
