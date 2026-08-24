/**
 * v22.6 B10 - Shadow mode guard.
 * Explicitly blocks any exchange execution path.
 */
'use strict';

const MODES = Object.freeze({
  PAPER: 'PAPER',
  SHADOW: 'SHADOW'
});

function normalizeMode(value) {
  const mode = String(value || MODES.PAPER).trim().toUpperCase();
  if (!Object.values(MODES).includes(mode)) throw new Error(`INVALID_TRADING_MODE:${mode}`);
  return mode;
}

function isShadow(mode) {
  return normalizeMode(mode) === MODES.SHADOW;
}

function assertNoLiveExecution(mode, operation = 'execution') {
  const normalized = normalizeMode(mode);
  if (normalized === MODES.SHADOW) {
    throw new Error(`SHADOW_LIVE_EXECUTION_BLOCKED:${operation}`);
  }
  return true;
}

module.exports = { MODES, normalizeMode, isShadow, assertNoLiveExecution };
