'use strict';

/**
 * Central fail-closed pre-trade gate.
 * Every execution intent should pass through this function.
 */
export function assertPreTradeSafe(ctx = {}) {
  if (ctx.dbHealthy !== true) throw new Error('PRETRADE_DB_UNHEALTHY');
  if (ctx.instanceLeaseValid !== true) throw new Error('PRETRADE_INSTANCE_LEASE_INVALID');
  if (ctx.marketDataHealthy !== true) throw new Error('PRETRADE_MARKET_DATA_UNHEALTHY');
  if (Number.isFinite(ctx.marketDataAgeMs) &&
      Number.isFinite(ctx.maxMarketDataAgeMs) &&
      ctx.marketDataAgeMs > ctx.maxMarketDataAgeMs) {
    throw new Error('PRETRADE_MARKET_DATA_STALE');
  }
  if (ctx.orderBookValid !== true) throw new Error('PRETRADE_ORDERBOOK_INVALID');
  if (Number.isFinite(ctx.spreadPct) &&
      Number.isFinite(ctx.maxSpreadPct) &&
      ctx.spreadPct > ctx.maxSpreadPct) {
    throw new Error('PRETRADE_SPREAD_TOO_WIDE');
  }
  if (ctx.risk?.allowed !== true) {
    throw new Error(`PRETRADE_RISK_BLOCK:${ctx.risk?.reason || 'UNKNOWN'}`);
  }
  if (ctx.reconciliationHealthy !== true) throw new Error('PRETRADE_RECONCILIATION_FAILED');
  if (ctx.killSwitch === true) throw new Error('PRETRADE_KILL_SWITCH');
  return true;
}

export default assertPreTradeSafe;
