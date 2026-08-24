'use strict';
const assert=require('assert');
// Bugfix: this file lives at the project root, not inside tests/, so the
// original '../src/...' paths pointed one directory too high and threw
// MODULE_NOT_FOUND. Corrected to './src/...'.
const {
  calculateRSI, calculateATR, calculateMACD, calculateEMA, calculateADX,
  calculateChoppinessIndex, calculateHurstExponent
}=require('./src/indicators');
const {evaluateDirectionGates,selectDirection}=require('./src/filter-system');

function candlesFrom(closes) {
  return closes.map((close,i)=>({time:1700000000000+i*900000,open:close-0.5,high:close+1,low:close-1,close,volume:10+i}));
}

// RSI known sanity: monotonic rise => 100.
assert(Math.abs(calculateRSI([1,2,3,4,5,6,7,8,9,10,11,12,13,14,15],14)-99.9000999)<1e-6);

// ATR sanity: constant range with no gaps.
const c=candlesFrom(Array.from({length:30},()=>100));
assert(Math.abs(calculateATR(c,14)-2)<1e-9);

// EMA/MACD should be finite and deterministic.
const prices=Array.from({length:60},(_,i)=>100+i*0.5);
assert(Number.isFinite(calculateEMA(prices,20)));
const macd=calculateMACD(prices);
assert(Number.isFinite(macd.histogram));

// ADX/chop/Hurst are finite with sufficient data.
const varied=candlesFrom(prices);
assert(Number.isFinite(calculateADX(varied,14)));
assert(Number.isFinite(calculateChoppinessIndex(varied,14)));
assert(Number.isFinite(calculateHurstExponent(prices)));

// FIX regression: disabled POC/VWAP and MACD must not alter score.
const cfg={REQUIRE_4H_TREND:false,ALLOW_COUNTER_BTC_TREND:true,MAX_FUNDING_RATE:1,MIN_FUNDING_RATE:-1,
  ADX_MIN:20,MIN_HURST_EXPONENT:.52,MAX_CHOP_INDEX:61.8,RSI_LONG_MIN:48,RSI_LONG_MAX:68,
  RSI_SHORT_MIN:32,RSI_SHORT_MAX:52,MIN_RELATIVE_VOLUME:1.2,MIN_GATE_SCORE:50};
const base={trend1h:'BULLISH',trend4h:'BULLISH',btcTrend:'BULLISH',bosBullish:true,bosBearish:false,fundingRate:0,
  adx:40,hurst:.6,chop:40,rsi:55,poc:90,vwap:90,currentPrice:100,macd:{histogram:-1},
  relativeVolume:1.5,adaptiveADX:30,adaptiveVolume:1.4};
const filters={adx:{enabled:true},hurst:{enabled:true},chop:{enabled:true},rsi_long_min:{enabled:true},
  rsi_short_max:{enabled:true},pocvwap:{enabled:false},macd:{enabled:false},relvol:{enabled:true},trend4h:{enabled:false},
  btctrend:{enabled:false},bos:{enabled:true}};
assert.equal(evaluateDirectionGates('LONG',base,{},cfg,filters),null);

// FIX regression: shorts disabled prevents secondary SHORT selection.
const disabled={...cfg,ENABLE_SHORT_SIGNALS:false};
const result=selectDirection({primaryDir:'LONG',gateParams:base,scanStats:{},config:disabled,filterState:filters});
assert.equal(result.direction,'LONG');

console.log('indicator/filter hardening tests: passed');
