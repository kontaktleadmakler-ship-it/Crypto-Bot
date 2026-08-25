/**
 * v22.5 B9 configuration. Conservative defaults.
 */
'use strict';

module.exports = {
  enabled: String(process.env.MARKET_WS_ENABLED || 'false').toLowerCase() === 'true',
  wsUrl: process.env.MARKET_WS_URL || '',
  recordingEnabled: String(process.env.MARKET_DATA_RECORDING || 'true').toLowerCase() !== 'false',
  dataDir: process.env.MARKET_DATA_DIR || './data/market-replay',
  replaySpeed: Number(process.env.MARKET_REPLAY_SPEED || 0),
  maxReconnectMs: Number(process.env.MARKET_WS_RECONNECT_MAX_MS || 30000)
};

// Step 4: sequenced local-L2 safety controls.
module.exports.orderBookMaxAgeMs = Number(process.env.ORDERBOOK_MAX_AGE_MS || process.env.MAX_MARKET_DATA_AGE_MS || 1500);
module.exports.requireWebSocket = String(process.env.MARKET_DATA_REQUIRE_WS || 'false').toLowerCase() === 'true';
module.exports.depthLevels = Number(process.env.ORDERBOOK_DEPTH_LEVELS || 10);
