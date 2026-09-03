const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const runtimePath = path.resolve(__dirname, '..', 'trading-bot-v25-marketdata-fixed.mjs');

const script = `
process.env.BOT_TEST_MODE='true';
process.env.ML_ENABLED='false';
const m = await import(${JSON.stringify(runtimePath)});
const s = () => ({trend4h:'BULLISH', trend1h:'BULLISH', btcTrend:'BULLISH', bosBullish:true, bosBearish:false, fundingRate:0, adx:35, hurst:0.65, chop:30, rsi:55, poc:100, vwap:100, currentPrice:101, macd:{histogram:1}, relativeVolume:2});
const stats = {trendQualityLow:0,rsiTooLow:0,rsiTooHigh:0,pocVwapFail:0,macdFail:0,relVolTooLow:0};
const cfg = {...m.__test.config, MIN_GATE_SCORE:55, REQUIRE_4H_TREND:true, ALLOW_COUNTER_BTC_TREND:false};
if (m.__test.evaluateDirectionGates('LONG', s(), stats, cfg) !== null) throw new Error('valid LONG rejected');
const short = {...s(), trend4h:'BEARISH', trend1h:'BEARISH', btcTrend:'BEARISH', bosBullish:false, bosBearish:true, rsi:45, macd:{histogram:-1}, currentPrice:99};
if (m.__test.evaluateDirectionGates('SHORT', short, stats, cfg) !== null) throw new Error('valid SHORT gate rejected');
if (m.__test.resolveSignalDirection('LONG', 'trendMismatch1h', null, false) !== null) throw new Error('disabled SHORT leaked through resolver');
if (m.__test.resolveSignalDirection('LONG', 'trendMismatch1h', null, true) !== 'SHORT') throw new Error('enabled SHORT was not resolved');
console.log('runtime direction gates: PASS');
`;
const r=spawnSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8',timeout:15000,env:{...process.env,BOT_TEST_MODE:'true',ML_ENABLED:'false'}});
if(r.status!==0){console.error(r.stdout||'');console.error(r.stderr||'');throw new Error('runtime direction-gates test failed');}
assert.match(r.stdout,/runtime direction gates: PASS/);
console.log('runtime-direction-gates: PASS');
