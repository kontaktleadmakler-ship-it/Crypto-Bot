const assert = require('assert');
const fs = require('fs');
const runtime = fs.readFileSync('trading-bot-v25-marketdata-fixed.mjs','utf8');
const dashboard = fs.readFileSync('dashboard.html','utf8');

assert(runtime.includes("app.get('/api/dashboard/outcome-forensics'"));
assert(runtime.includes('hardCodedSymbol: false'));
assert(runtime.includes('jarvisEventBus.recent'));
assert(runtime.includes('buildCoinTimeline(events, sym)'));
assert(dashboard.includes('/api/dashboard/outcome-forensics?limit=300'));
assert(dashboard.includes('ALL COINS'));
assert(!dashboard.includes("state={symbol:'BTC-USDT'"));
console.log('dashboard-multicoin-outcome.test.js: PASS');
