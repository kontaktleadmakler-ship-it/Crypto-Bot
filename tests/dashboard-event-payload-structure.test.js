'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const runtime = fs.readFileSync(path.join(root, 'trading-bot-v25-marketdata-fixed.mjs'), 'utf8');
const dashboard = fs.readFileSync(path.join(root, 'dashboard.html'), 'utf8');

const signalFields = ['symbol','direction','signalId','signalScore','entryPrice','stopLoss','tp1','tp2','paperExecution'];
const agentFields = ['symbol','direction','nodes','dqn','confidence','consensus','vetoes','finalAction','phase','gateStage','signalScore'];

const signalStart = runtime.indexOf("jarvisEventBus.emitEvent('SIGNAL:GENERATED'");
assert(signalStart >= 0, 'SIGNAL:GENERATED emission missing');
const signalEnd = runtime.indexOf("}, { source: 'scanner'", signalStart);
assert(signalEnd > signalStart, 'SIGNAL:GENERATED payload boundary missing');
const signalPayload = runtime.slice(signalStart, signalEnd);

const agentStart = runtime.indexOf("jarvisEventBus.emitEvent('AGENTS:EVALUATED'", Math.max(0, runtime.indexOf("gateStage:'PRE_GATE'") - 5000));
assert(agentStart >= 0, 'PRE_GATE AGENTS:EVALUATED emission missing');
const agentEnd = runtime.indexOf("}, { source: 'agent-suite'", agentStart);
assert(agentEnd > agentStart, 'AGENTS:EVALUATED payload boundary missing');
const agentPayload = runtime.slice(agentStart, agentEnd);

for (const field of signalFields) assert.match(signalPayload, new RegExp(`\\b${field}\\b`), `runtime signal payload missing ${field}`);
for (const field of agentFields) assert.match(agentPayload, new RegExp(`\\b${field}\\b`), `runtime agent payload missing ${field}`);

assert.match(dashboard, /if\(evt\.type==='AGENTS:EVALUATED'\)/);
assert.match(dashboard, /state\.agents=\{\.\.\.\(evt\.payload\|\|\{\}\)/);
assert.match(dashboard, /if\(evt\.type==='SIGNAL:GENERATED'\)/);
assert.match(dashboard, /const p=evt\.payload\|\|\{\}, sym=String\(evt\.symbol\|\|p\.symbol/);
assert.match(dashboard, /const row=\{[^\n]*\.\.\.p,symbol:sym/);

const agentRender = dashboard.slice(dashboard.indexOf('function renderAgents()'), dashboard.indexOf('function renderLiveControl()'));
for (const field of ['nodes','dqn','confidence','finalAction']) {
  assert.match(
    agentRender + dashboard.slice(dashboard.indexOf('function renderNeuralDetail()'), dashboard.length),
    new RegExp(`\\b${field}\\b`),
    `dashboard does not consume ${field}`
  );
}

console.log('dashboard-event-payload-structure.test.js: PASS');
