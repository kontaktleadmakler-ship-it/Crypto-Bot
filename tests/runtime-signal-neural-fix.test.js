// Canonical CI copy; scripts/run-all-tests.js executes tests/*.test.js only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const runtime = fs.readFileSync(path.join(root, 'trading-bot-v25-marketdata-fixed.mjs'), 'utf8');
const dashboard = fs.readFileSync(path.join(root, 'dashboard.html'), 'utf8');

assert.match(runtime, /function evaluateDirectionGates\(dir, p, scanStats, gateConfig\)/);
assert.match(runtime, /gateStage:'PRE_GATE'/);
assert.match(runtime, /jarvisEventBus\.emitEvent\('AGENTS:EVALUATED'/);
assert.match(runtime, /jarvisEventBus\.emitEvent\('SIGNAL:GENERATED'/);
assert.match(dashboard, /evt\.type==='AGENTS:EVALUATED'/);
assert.match(dashboard, /evt\.type==='SIGNAL:GENERATED'/);

const agentPos = runtime.indexOf("jarvisEventBus.emitEvent('AGENTS:EVALUATED'");
const gatePos = runtime.indexOf('evaluateDirectionGates(primaryDir');
assert(agentPos > 0 && agentPos < gatePos, 'agent telemetry must be emitted before directional gate evaluation');

const signalPos = runtime.indexOf("jarvisEventBus.emitEvent('SIGNAL:GENERATED'");
const paperPos = runtime.indexOf('let paperOrder = null;', signalPos);
assert(signalPos > 0 && paperPos > signalPos, 'signal generation must precede paper execution');

console.log('runtime-signal-neural-fix: PASS');
