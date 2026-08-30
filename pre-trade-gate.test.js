import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertPreTradeSafe } from '../../pre-trade-gate.mjs';

const healthy = {
  dbHealthy: true,
  instanceLeaseValid: true,
  marketDataHealthy: true,
  marketDataAgeMs: 10,
  maxMarketDataAgeMs: 5000,
  orderBookValid: true,
  spreadPct: 0.05,
  maxSpreadPct: 0.5,
  risk: { allowed: true },
  reconciliationHealthy: true,
  killSwitch: false
};

test('pre-trade gate accepts healthy state', () => {
  assert.equal(assertPreTradeSafe(healthy), true);
});

test('pre-trade gate fails closed on stale market data', () => {
  assert.throws(() =>
    assertPreTradeSafe({ ...healthy, marketDataAgeMs: 6000 })
  );
});

test('pre-trade gate fails closed on DB outage', () => {
  assert.throws(() =>
    assertPreTradeSafe({ ...healthy, dbHealthy: false })
  );
});

test('pre-trade gate fails closed on invalid orderbook', () => {
  assert.throws(() =>
    assertPreTradeSafe({ ...healthy, orderBookValid: false })
  );
});
