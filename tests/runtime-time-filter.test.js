const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const runtimePath = path.resolve(__dirname, '..', 'trading-bot-v25-marketdata-fixed.mjs');
const script = `
process.env.BOT_TEST_MODE='true';
process.env.ML_ENABLED='false';
const m = await import(${JSON.stringify(runtimePath)});
const base = {...m.__test.config, MIN_GATE_SCORE:55, TIME_FILTER_SCORE_PENALTY:15, TIME_FILTER_SCORE_PENALTY_SOFT:7};
const date = new Date('2026-09-03T10:00:00Z');
const hour = date.getUTCHours();
const day = date.getUTCDay();
const stats = {hourlyStats: [], dailyStats: []};
stats.hourlyStats[hour] = {trades:4,pnl:-100};
stats.dailyStats[day] = {trades:7,pnl:-100};
let scan = {timeThrottled:0};
let cfg = m.__test.applyTimeFilterPenalty(base, stats, date, scan);
if (cfg !== base || scan.timeThrottled !== 0) throw new Error('below-sample filter should not throttle');
stats.hourlyStats[hour] = {trades:5,pnl:-100};
cfg = m.__test.applyTimeFilterPenalty(base, stats, date, scan);
if (cfg.MIN_GATE_SCORE !== 62 || scan.timeThrottled !== 1) throw new Error('soft penalty incorrect');
stats.dailyStats[day] = {trades:8,pnl:-100};
cfg = m.__test.applyTimeFilterPenalty(base, stats, date, scan);
if (cfg.MIN_GATE_SCORE !== 70 || scan.timeThrottled !== 2) throw new Error('hard penalty incorrect');
if (base.MIN_GATE_SCORE !== 55) throw new Error('base config was mutated');
console.log('runtime time-filter: PASS');
`;
const r=spawnSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8',timeout:15000,env:{...process.env,BOT_TEST_MODE:'true',ML_ENABLED:'false'}});
if(r.status!==0){console.error(r.stdout||'');console.error(r.stderr||'');throw new Error('runtime time-filter test failed');}
assert.match(r.stdout,/runtime time-filter: PASS/);
console.log('runtime-time-filter: PASS');
