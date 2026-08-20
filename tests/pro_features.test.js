'use strict';
const assert = require('assert');
const { buildFeatureSnapshot, volumeWeightedMACD, ichimoku, fibonacciLevels, multiTimeframeConfluence, trueCVDFromTrades, approximateCVD } = require('../feature-engine');
const { PrioritizedReplayBuffer } = require('../prioritized-replay');
const { ConceptDriftMonitor } = require('../drift-monitor');
const { twapSchedule, vwapSchedule, slippageBps } = require('../execution-algos');
const { KillSwitch } = require('../risk-controls');

function candles(n=180){ return Array.from({length:n},(_,i)=>({time:i*900000,open:100+i*.05,high:101+i*.05,low:99+i*.05,close:100+i*.05,volume:1000+(i%10)*50})); }
const c=candles();
assert(Number.isFinite(volumeWeightedMACD(c).histogram));
assert.strictEqual(ichimoku(c).cloudBias,'BULLISH');
assert(Object.keys(fibonacciLevels(c).levels).length===5);
assert(multiTimeframeConfluence({'1m':'BULLISH','5m':'BULLISH','15m':'BULLISH','1h':'BULLISH','4h':'BULLISH'},'LONG','TRENDING').score===100);
assert.strictEqual(trueCVDFromTrades([{side:'buy',size:10},{side:'sell',size:4}]).delta,6);
assert.strictEqual(approximateCVD(c).isTrueCVD,false);
assert(buildFeatureSnapshot({candlesByTf:{'1m':[],'5m':[],'15m':c,'1h':c,'4h':c},phase:'TRENDING',direction:'LONG'}).confluence);
const replay=new PrioritizedReplayBuffer({capacity:3}); replay.add({id:1},1); replay.add({id:2},3); replay.add({id:3},2); assert.strictEqual(replay.size,3); assert.strictEqual(replay.sample(2).items.length,2);
const drift=new ConceptDriftMonitor({window:20,threshold:.01}); for(let i=0;i<30;i++) drift.add(.9,1); for(let i=0;i<10;i++) drift.add(.1,1); assert(drift.status().score>=0);
assert.strictEqual(twapSchedule({quantity:100,slices:4}).reduce((a,b)=>a+b.size,0),100);
assert(vwapSchedule({quantity:100,volumeBuckets:[1,2,1],participation:1}).length===3);
assert(slippageBps(100,101,'buy')===100);
const gapCandles = candles(30).filter((_, i) => i !== 15); const tolerant = require('../data-validator').DataValidator; const dv = new tolerant({maxAgeMs: 60*60*1000}); assert(dv.candles(gapCandles, {timeframeMs:15*60*1000, now:gapCandles.at(-1).time, allowGaps:true, maxGapFactor:4}).valid);
const ks=new KillSwitch(); assert(ks.status().active===true); ks.disable(); assert(ks.status().active===false); ks.enable(); assert(ks.status().active===true);
console.log('✅ Pro feature tests passed');
