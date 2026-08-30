'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const runtime = fs.readFileSync(path.join(root, 'trading-bot-v24.6-runtime.mjs'), 'utf8');
const backtest = fs.readFileSync(path.join(root, 'backtest-engine.js'), 'utf8');
const adapter = fs.readFileSync(path.join(root, 'exchange-adapter.js'), 'utf8');

assert(runtime.includes("require('./src/indicators')"), 'runtime must use canonical indicators');
assert(backtest.includes("require('./src/indicators')"), 'backtest must use canonical indicators');
for (const fn of ['calculateEMA','calculateEMASeries','calculateRSI','calculateATR','calculateADX','calculateHurstExponent','calculateMACD','calculateChoppinessIndex','calculateVolumeProfilePOC','calculateRelativeVolume','checkSwingBreakOfStructure']) {
  assert(!new RegExp(`function\\s+${fn}\\s*\\(`).test(runtime), `runtime still defines ${fn}`);
  assert(!new RegExp(`function\\s+${fn}\\s*\\(`).test(backtest), `backtest still defines ${fn}`);
}
assert(backtest.includes('lastBarIndexAtOrBefore(btcBars, bar.time)'), 'BTC alignment must be timestamp based');
assert(!runtime.includes('riskGovernor.evaluate('), 'runtime must not use a second risk facade');
assert(runtime.includes('riskEngine.assess({'), 'runtime must use RiskEngine');
assert(runtime.includes("state-persistence-failed:dailyPnL"), 'daily PnL persistence must fail closed');
assert(runtime.includes("state-persistence-failed:peakCapital"), 'peak capital persistence must fail closed');
assert(runtime.includes("state-persistence-failed:botControl"), 'pause state persistence must fail closed');
assert(adapter.includes('ORDER_EXECUTION_DISABLED'), 'live order execution guard must remain disabled');
console.log('consolidation: PASS');
