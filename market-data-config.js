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
