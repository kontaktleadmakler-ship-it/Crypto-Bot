'use strict';

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const tf = require('@tensorflow/tfjs-node');
const { TensorFlowSignalModel, FEATURE_NAMES } = require('./ml-engine');

const FUTURES_GRANULARITY_MINUTES = { '1m': 1, '5m': 5, '15m': 15, '1h': 60, '4h': 240, '1d': 1440 };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function finite(v, f = 0) { const n = Number(v); return Number.isFinite(n) ? n : f; }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

const {
  calculateEMA, calculateEMASeries, calculateRSI, calculateATR, calculateADX,
  calculateHurstExponent, calculateMACD, calculateVWAP, calculateVolumeProfilePOC,
  calculateRelativeVolume, checkSwingBreakOfStructure, calculateChoppinessIndex,
  findSwingStop, aggregate, trend
} = require('./src/indicators');
const { lastBarIndexAtOrBefore } = require('./backtest-time-utils');








// Punkt 8 - VWAP-Konsistenz: Berechnung lebt jetzt ausschließlich in
// ./vwap-calculator.js und wird von Live-Bot und Backtest-Engine gemeinsam
// genutzt, damit beide bei identischen Eingabedaten bitgenau dasselbe Ergebnis
// liefern.




// NOTE: `time` is now the OPEN time of the first constituent 15m bar (matches
// exchange candle convention), not the last bar's time. This is required so
// callers can test "is this HTF candle fully closed yet?" via
// `htfCandle.time + timeframeMs <= currentBar.time` (see runBacktest below).


// Finds the most recent swing high/low over `lookback` bars (excluding the
// current bar) to use as a structure-based stop reference instead of a rigid
// ATR multiple.


function detectMarketPhase(btcTrend, btcADX, btcVolatility){if(btcADX>=25&&btcVolatility<0.03)return 'TRENDING';if(btcVolatility>=0.03)return 'VOLATILE';return btcTrend==='BULLISH'||btcTrend==='BEARISH'?'TRENDING':'RANGING';}
function adaptiveConfig(phase, base){const m=phase==='VOLATILE'?{adx:1.15,atr:0.3,tp1:-0.1,vol:1.15}:phase==='TRENDING'?{adx:0.9,atr:0,tp1:0,vol:0.95}:{adx:1.05,atr:0.15,tp1:-0.05,vol:1.05};return {adx:base.ADX_MIN*m.adx,atr:base.ATR_STOP_MULT+m.atr,tp1:base.TP1_MULT+m.tp1,vol:base.MIN_RELATIVE_VOLUME*m.vol};}
function signalScore(p){let s=Math.min(p.adx/50,1)*30;const opt=p.direction==='LONG'?55:45;s+=Math.max(0,1-Math.abs(p.rsi-opt)/30)*20;s+=Math.min(p.relativeVolume/2,1)*20;if(p.trend1h===(p.direction==='LONG'?'BULLISH':'BEARISH'))s+=15;if(p.trend4h===(p.direction==='LONG'?'BULLISH':'BEARISH'))s+=15;return Math.round(Math.min(s,100));}
// --- Hard gates: structural preconditions that must never be traded around.
// Without directional trend alignment and a break of structure the setup is
// not the strategy this bot claims to trade, so these stay boolean.
function hardGates(dir,p,cfg){
  const long=dir==='LONG';
  if(cfg.REQUIRE_4H_TREND&&p.trend4h!==(long?'BULLISH':'BEARISH'))return false;
  if(p.trend1h!==(long?'BULLISH':'BEARISH')||p.trend15m!==(long?'BULLISH':'BEARISH'))return false;
  if(!cfg.ALLOW_COUNTER_BTC_TREND&&((p.btcTrend==='BEARISH'&&long)||(p.btcTrend==='BULLISH'&&!long)))return false;
  if(long?!p.bosBullish:!p.bosBearish)return false;
  return true;
}

// --- Punkt 10 - Trend Quality Score: ADX, Hurst und Chop maßen bisher alle
// "Trendstärke" getrennt (25+20+15 = 60% der maximal erreichbaren Punkte)
// und verdoppelten damit effektiv dieselbe Information im Confluence-Score.
// Sie werden jetzt zu einem einzigen gewichteten Score zusammengefasst:
//   trendQuality = (adx/100 * 0.5) + (hurst * 0.3) + ((100-chop)/100 * 0.2)
// Ergebnis liegt zwischen 0 und 1 und ersetzt die drei separaten Blöcke,
// identisch zur Live-Bot-Logik in trading-bot-v21_1-tfjs.js.
function gateScore(dir,p,cfg){
  const long=dir==='LONG';
  let score=0, max=0;

  max+=60;
  const trendQuality=Math.max(0,Math.min(1,(p.adx/100)*0.5+p.hurst*0.3+((100-p.chop)/100)*0.2));
  score+=60*trendQuality;

  max+=15;
  const inRsiZone = long ? (p.rsi>=cfg.RSI_LONG_MIN&&p.rsi<=cfg.RSI_LONG_MAX) : (p.rsi>=cfg.RSI_SHORT_MIN&&p.rsi<=cfg.RSI_SHORT_MAX);
  if(inRsiZone) score+=15;

  max+=10;
  const atPremium = long ? (p.price>=p.poc&&p.price>=p.vwap) : (p.price<=p.poc&&p.price<=p.vwap);
  if(atPremium) score+=10;

  max+=10; if(long?p.macd.histogram>=0:p.macd.histogram<=0) score+=10;
  max+=5; if(p.relativeVolume>=p.adaptive.vol) score+=5; else score+=Math.max(0,5*(p.relativeVolume/p.adaptive.vol));

  return Math.round(100*score/max);
}

function evaluateGates(dir,p,cfg){
  if(!hardGates(dir,p,cfg)) return false;
  return gateScore(dir,p,cfg) >= (cfg.MIN_GATE_SCORE ?? 55);
}

async function fetchKucoinCandles(symbol, timeframe='15m', days=30, opts={}){
  const gran=FUTURES_GRANULARITY_MINUTES[timeframe];if(!gran)throw new Error(`Unsupported timeframe ${timeframe}`);
  const now=Date.now(), start=now-days*86400000, step=gran*60*1000*480;let to=now, all=[];
  const futuresSymbol=symbol.split('-')[0]==='BTC'?'XBTUSDTM':`${symbol.split('-')[0]}USDTM`;
  while(to>start){const from=Math.max(start,to-step),url=`https://api-futures.kucoin.com/api/v1/kline/query?symbol=${futuresSymbol}&granularity=${gran}&from=${from}&to=${to}`;let res;
    for(let a=0;a<4;a++){try{res=await axios.get(url,{timeout:15000});break;}catch(e){if(a===3)throw e;await sleep(1000*(a+1));}}
    const rows=res?.data?.data||[];if(!rows.length)break;
    for(const c of rows){const t=Number(c[0]);if(t>=start&&t<now)all.push({time:t,open:Number(c[1]),high:Number(c[2]),low:Number(c[3]),close:Number(c[4]),volume:Number(c[5])});}
    const minT=Math.min(...rows.map(c=>Number(c[0])));if(minT<=start)break;to=minT-1;await sleep(opts.delayMs??150);
  }
  const map=new Map();for(const c of all)map.set(c.time,c);return [...map.values()].sort((a,b)=>a.time-b.time);
}

// Punkt 9 - Historische Funding-Daten im Backtest: bisher wurde die Funding
// Rate im Backtest hart auf 0 gesetzt, was die PnL-Berechnung bei längeren
// Haltedauern verfälscht (Funding wird auf KuCoin Futures alle 8h fällig).
// fetchHistoricalFunding lädt die tatsächlichen historischen Raten für den
// Backtest-Zeitraum; fundingCostForPeriod ordnet sie den jeweiligen
// Kerzen-Perioden zu und wird pro Bar in simulateSignal verrechnet.
async function fetchHistoricalFunding(symbol, startTime, endTime) {
  const futuresSymbol = symbol.split('-')[0] === 'BTC' ? 'XBTUSDTM' : `${symbol.split('-')[0]}USDTM`;
  const url = `https://api-futures.kucoin.com/api/v1/contract/funding-rates?symbol=${futuresSymbol}&from=${startTime}&to=${endTime}`;
  let res;
  for (let a = 0; a < 4; a++) {
    try { res = await axios.get(url, { timeout: 15000 }); break; }
    catch (e) { if (a === 3) { return []; } await sleep(1000 * (a + 1)); }
  }
  const rows = res?.data?.data || [];
  return rows
    .map(r => ({ time: Number(r.timepoint ?? r.fundingTime ?? r.time), fundingRate: Number(r.fundingRate) }))
    .filter(r => Number.isFinite(r.time) && Number.isFinite(r.fundingRate))
    .sort((a, b) => a.time - b.time);
}

function applySlippage(price,direction,pct,side='entry',cfg={}){const spread=Number(cfg.BACKTEST_SPREAD_PERCENT||0);const slip=Number(pct||0);const total=(spread/2)+slip;const f=side==='entry'?(direction==='LONG'?1+total/100:1-total/100):(direction==='LONG'?1-total/100:1+total/100);return price*f;}
function fee(notional,pct,cfg={}){const taker=Number(cfg.BACKTEST_TAKER_FEE_PERCENT ?? pct ?? 0);return Math.abs(notional)*taker/100;}
function buildConfig(env={}){const n=(k,d)=>env[k]!==undefined?Number(env[k]):d;const b=(k,d)=>env[k]!==undefined?env[k]!=='false':d;return {CAPITAL_USD:n('CAPITAL_USD',10000),RISK_PERCENT:n('RISK_PERCENT',0.75),MAX_CONCURRENT_TRADES:n('MAX_CONCURRENT_TRADES',3),MAX_SAME_DIRECTION:n('MAX_SAME_DIRECTION',2),MAX_DAILY_LOSS_USD:n('MAX_DAILY_LOSS_USD',250),MAX_EXPOSURE_RATIO:n('MAX_EXPOSURE_RATIO',0.6),LEVERAGE:n('LEVERAGE',3),ATR_STOP_MULT:n('ATR_STOP_MULT',2.3),TP1_MULT:n('TP1_MULT',1.3),TP2_MULT:n('TP2_MULT',2.5),MAX_HOLD_HOURS:n('MAX_HOLD_HOURS',4),ABSOLUTE_MAX_HOLD_HOURS:n('ABSOLUTE_MAX_HOLD_HOURS',24),TRAILING_STOP_ENABLED:b('TRAILING_STOP_ENABLED',true),TRAILING_ATR_MULT:n('TRAILING_ATR_MULT',2.2),TP1_CLOSE_PERCENT:n('TP1_CLOSE_PERCENT',60),SLIPPAGE_PERCENT:n('SLIPPAGE_PERCENT',0.10),FEE_PERCENT:n('FEE_PERCENT',0.1),BACKTEST_SPREAD_PERCENT:n('BACKTEST_SPREAD_PERCENT',0.0),BACKTEST_TAKER_FEE_PERCENT:n('BACKTEST_TAKER_FEE_PERCENT',n('FEE_PERCENT',0.1)),BACKTEST_MAKER_FEE_PERCENT:n('BACKTEST_MAKER_FEE_PERCENT',n('FEE_PERCENT',0.1)),MAX_CHOP_INDEX:n('MAX_CHOP_INDEX',61.8),MIN_HURST_EXPONENT:n('MIN_HURST_EXPONENT',0.52),ADX_MIN:n('ADX_MIN',20),RSI_LONG_MIN:n('RSI_LONG_MIN',48),RSI_LONG_MAX:n('RSI_LONG_MAX',68),RSI_SHORT_MIN:n('RSI_SHORT_MIN',32),RSI_SHORT_MAX:n('RSI_SHORT_MAX',52),MIN_RELATIVE_VOLUME:n('MIN_RELATIVE_VOLUME',1.2),MIN_GATE_SCORE:n('MIN_GATE_SCORE',55),MIN_RRR:n('MIN_RRR',1.5),SWING_LOOKBACK:n('SWING_LOOKBACK',10),BOS_LOOKBACK:n('BOS_LOOKBACK',10),TREND_EMA_FAST_15M:n('TREND_EMA_FAST_15M',20),TREND_EMA_SLOW_15M:n('TREND_EMA_SLOW_15M',50),REQUIRE_4H_TREND:b('REQUIRE_4H_TREND',true),ALLOW_COUNTER_BTC_TREND:b('ALLOW_COUNTER_BTC_TREND',false),ENABLE_SHORT_SIGNALS:b('ENABLE_SHORT_SIGNALS',true),ML_MIN_PREDICTION_PROBABILITY:n('ML_MIN_PREDICTION_PROBABILITY',0.55),ML_ENABLED:b('ML_ENABLED',true),ML_MIN_TRAINING_SAMPLES:n('ML_MIN_TRAINING_SAMPLES',40),ML_EPOCHS:n('ML_EPOCHS',50),ML_BATCH_SIZE:n('ML_BATCH_SIZE',32),BACKTEST_STARTING_CAPITAL:n('BACKTEST_STARTING_CAPITAL',n('CAPITAL_USD',10000)),BACKTEST_MAX_TRAIN_TRADES:n('BACKTEST_MAX_TRAIN_TRADES',1000),BACKTEST_RETRAIN_EVERY_SIGNALS:n('BACKTEST_RETRAIN_EVERY_SIGNALS',25),BACKTEST_TRAIN_DAYS:n('BACKTEST_TRAIN_DAYS',30),BACKTEST_TEST_DAYS:n('BACKTEST_TEST_DAYS',7),BACKTEST_PURGE_DAYS:n('BACKTEST_PURGE_DAYS',1),BACKTEST_EMBARGO_DAYS:n('BACKTEST_EMBARGO_DAYS',1),BACKTEST_WARMUP_BARS:n('BACKTEST_WARMUP_BARS',300),BACKTEST_USE_ML:b('BACKTEST_USE_ML',true),REQUIRE_FUNDING_HISTORY:b('REQUIRE_FUNDING_HISTORY',true),HYPERPARAM_SEARCH_SAMPLES:n('HYPERPARAM_SEARCH_SAMPLES',60)};}

function buildSnapshot(candles15, candles1h, candles4h, btcCandles, cfg){const closes15=candles15.map(c=>c.close),price=closes15.at(-1),t4=trend(candles4h,20,50),t1=trend(candles1h,20,50),t15=trend(candles15,cfg.TREND_EMA_FAST_15M,cfg.TREND_EMA_SLOW_15M),btc=trend(btcCandles,20,50),adx=calculateADX(candles15,14),hurst=calculateHurstExponent(closes15),rsi=calculateRSI(closes15,14),atr=calculateATR(candles15,14),poc=calculateVolumeProfilePOC(candles15,30),vwap=calculateVWAP(candles15),macd=calculateMACD(closes15),b=checkSwingBreakOfStructure(candles15,cfg.BOS_LOOKBACK),rv=calculateRelativeVolume(candles15,20),chop=calculateChoppinessIndex(candles15,14),phase=detectMarketPhase(btc,calculateADX(btcCandles,14),btcCandles.at(-1)?.close?atr/candles15.at(-1).close:0),adaptive=adaptiveConfig(phase,cfg);return {price,trend4h:t4,trend1h:t1,trend15m:t15,btcTrend:btc,adx,hurst,rsi,atr,poc,vwap,macd,bosBullish:b.bosBullish,bosBearish:b.bosBearish,relativeVolume:rv,chop,marketPhase:phase,adaptive};}

function candidate(snapshot,cfg){const primary=snapshot.trend1h==='BULLISH'?'LONG':'SHORT';let dir=evaluateGates(primary,snapshotForDir(snapshot,primary),cfg)?primary:null;if(!dir&&cfg.ENABLE_SHORT_SIGNALS){const other=primary==='LONG'?'SHORT':'LONG';if(evaluateGates(other,snapshotForDir(snapshot,other),cfg))dir=other;}if(!dir)return null;const p=snapshotForDir(snapshot,dir),score=signalScore(p);return {...p,direction:dir,signalScore:score};}
function snapshotForDir(s,d){return {...s,direction:d};}

function tradeFeatures(model,c){const price=c.price;return model.buildFeatures({adx:c.adx,rsi:c.rsi,relativeVolume:c.relativeVolume,signalScore:c.signalScore,atrPct:price?c.atr/price*100:0,hurst:c.hurst,macdHistogramPct:price?c.macd.histogram/price*100:0,pocDistancePct:c.poc&&price?(price-c.poc)/price*100:0,vwapDistancePct:c.vwap&&price?(price-c.vwap)/price*100:0,fundingRate:0,orderBookImbalance:1,trend4h:c.trend4h,trend1h:c.trend1h,trend15m:c.trend15m,btcTrend:c.btcTrend,direction:c.direction,marketPhase:c.marketPhase});}

// Punkt 6 - ML-Feature-Leakage: signal.entry ist der Fill-Preis der NÄCHSTEN
// Kerze (nach Signalentscheidung, siehe runBacktest: sig.entry=bars[i+1].open)
// und stand zum Zeitpunkt der Signalgenerierung noch nicht fest. Für die
// Normalisierung von POC-/VWAP-Distanz sowie ATR%/MACD% muss stattdessen
// signal.price (Schlusskurs der letzten abgeschlossenen 15m-Kerze zum
// Entscheidungszeitpunkt) verwendet werden - identisch zur Live-Bot-Logik,
// die currentPrice (nicht entryPrice) für dieselben Prozentwerte nutzt.
function makeModelRecord(signal, pnlUSD, closeTime){
  const p = signal.price;
  return {
    entry: signal.entry,
    signalPriceAtEntry: p,
    pnlUSD, direction: signal.direction,
    adxAtEntry: signal.adx, rsiAtEntry: signal.rsi, relativeVolumeAtEntry: signal.relativeVolume,
    signalScore: signal.signalScore,
    atrAtEntry: signal.atr,
    atrPctAtEntry: p ? (signal.atr / p) * 100 : 0,
    hurstAtEntry: signal.hurst,
    macdHistogramAtEntry: signal.macd.histogram,
    macdHistogramPctAtEntry: p ? (signal.macd.histogram / p) * 100 : 0,
    pocDistancePctAtEntry: signal.poc && p ? (p - signal.poc) / p * 100 : 0,
    vwapDistancePctAtEntry: signal.vwap && p ? (p - signal.vwap) / p * 100 : 0,
    fundingRateAtEntry: 0, orderBookImbalanceAtEntry: 1,
    trend4hAtEntry: signal.trend4h, trend1hAtEntry: signal.trend1h, trend15mAtEntry: signal.trend15m,
    btcTrendAtEntry: signal.btcTrend, marketPhase: signal.marketPhase, closeTime
  };
}

async function trainModelFromRecords(model,records,cfg){
  if(!records||records.length<cfg.ML_MIN_TRAINING_SAMPLES)return false;
  const positives=records.filter(r=>r.pnlUSD>0).length;
  if(positives<5||records.length-positives<5)return false;

  const ds=records.slice(-cfg.BACKTEST_MAX_TRAIN_TRADES).map(r=>({f:model.featuresFromTrade(r),y:r.pnlUSD>0?1:0}));
  const split=Math.max(1,Math.floor(ds.length*.8));
  const tr=ds.slice(0,split),va=ds.slice(split);
  if(!va.length)return false;

  const scaler=model.makeScaler(tr.map(x=>x.f));
  let xs,ys,vx,vy,net;
  try{
    xs=tf.tensor2d(model.scaleMatrix(tr.map(x=>x.f),scaler));
    ys=tf.tensor2d(tr.map(x=>[x.y]));
    vx=tf.tensor2d(model.scaleMatrix(va.map(x=>x.f),scaler));
    vy=tf.tensor2d(va.map(x=>[x.y]));
    net=tf.sequential();
    // inputShape must match FEATURE_NAMES.length from ml-engine.js (19
    // features, including spreadPct/volatilityRatio). This was hardcoded to
    // 17 - a stale value from before those two features existed. Every
    // xs/vx tensor built above is actually shape [n,19], so net.fit()
    // threw a shape-mismatch error on every walk-forward retrain attempt;
    // the catch block below swallowed it, so the backtest's ML layer
    // silently stayed untrained (falling back to gate-only signals) for
    // the entire run without surfacing an error to the user.
    net.add(tf.layers.dense({inputShape:[FEATURE_NAMES.length],units:32,activation:'relu',kernelInitializer:'heNormal'}));
    net.add(tf.layers.dropout({rate:.15}));
    net.add(tf.layers.dense({units:16,activation:'relu'}));
    net.add(tf.layers.dense({units:8,activation:'relu'}));
    net.add(tf.layers.dense({units:1,activation:'sigmoid'}));
    net.compile({optimizer:tf.train.adam(.001),loss:'binaryCrossentropy',metrics:['accuracy']});
    await net.fit(xs,ys,{epochs:cfg.ML_EPOCHS,batchSize:Math.min(cfg.ML_BATCH_SIZE,tr.length),validationData:[vx,vy],shuffle:false,verbose:0,callbacks:tf.callbacks.earlyStopping({monitor:'val_loss',patience:7,restoreBestWeight:true})});
    // Dispose the previous model's tensors before overwriting - the old
    // model.model reference would otherwise leak on every retrain cycle.
    if(model.model && model.model!==net) { try { model.model.optimizer?.dispose?.(); } catch (_) {} try { model.model.dispose(); } catch (_) {} }
    model.model=net;
    model.scaler=scaler;
    model.trained=true;
    return true;
  }catch(e){
    console.error(`[Backtest ML] Training fehlgeschlagen, überspringe Retrain: ${e.message}`);
    if(net && net!==model.model) { try { net.optimizer?.dispose?.(); } catch (_) {} try { net.dispose(); } catch (_) {} }
    return false;
  }finally{
    [xs,ys,vx,vy].forEach(t=>{try{t?.dispose();}catch(_){}});
  }
}

function predictWith(model,features){
  try{ return model.predict(features); }
  catch(e){ return { probability:0.5, class:'UNKNOWN', confidence:0, trained:false }; }
}

function simulateSignal(signal, bars, startIndex, cfg, fundingHistory=[]){
  const entry=applySlippage(bars[startIndex].open,signal.direction,cfg.SLIPPAGE_PERCENT,'entry');
  const atrDist=signal.atr*signal.adaptive.atr;

  // Structure-based stop: prefer the most recent swing low/high (real support
  // /resistance) over a rigid ATR multiple. The ATR distance is kept as a
  // sanity floor/ceiling (0.8x-3x) so a stray wick can't put the stop
  // absurdly close or absurdly far from price when using swing levels.
  const history=bars.slice(0,startIndex);
  const swingLevel=findSwingStop(history,signal.direction,cfg.SWING_LOOKBACK);
  let stopDist=atrDist;
  if(swingLevel!=null && Number.isFinite(swingLevel)){
    const swingDist=Math.abs(entry-swingLevel);
    if(swingDist>0) stopDist=clamp(swingDist,atrDist*0.8,atrDist*3);
  }

  let stop=signal.direction==='LONG'?entry-stopDist:entry+stopDist;

  // Enforce a minimum risk:reward ratio on TP1. Previously TP1 distance was
  // simply stopDist*adaptive.tp1, and with the default TP1_MULT (1.3) vs
  // ATR_STOP_MULT (2.3) that produced RRR ~0.57 - a structurally losing
  // setup even at >50% win rate. TP1 distance is now floored at
  // stopDist*cfg.MIN_RRR.
  const actualStopDistance=Math.abs(entry-stop); const tp1Dist=Math.max(stopDist*signal.adaptive.tp1, actualStopDistance*cfg.MIN_RRR); if(actualStopDistance<=0 || (tp1Dist/actualStopDistance)<cfg.MIN_RRR) return {pnlUSD:0,entry,exitPrice:entry,reason:'rrr-below-minimum',closeTime:bars[startIndex].time,closeIndex:startIndex,barsHeld:0,tp1Hit:false,fundingCostUSD:0,signal};
  const tp2Dist=Math.max(stopDist*cfg.TP2_MULT, tp1Dist*1.3);
  const tp1=signal.direction==='LONG'?entry+tp1Dist:entry-tp1Dist;
  const tp2=signal.direction==='LONG'?entry+tp2Dist:entry-tp2Dist;
  const riskPerUnit=Math.abs(entry-stop);const riskUSD=cfg.BACKTEST_STARTING_CAPITAL*(cfg.RISK_PERCENT/100);const units=riskPerUnit>0?riskUSD/riskPerUnit:0;let remaining=units,realized=0,tp1Hit=false,highest=entry,lowest=entry;const entryFee=fee(units*entry,cfg.FEE_PERCENT,cfg);let exitPrice=bars[startIndex].open,reason='end';let lastIndex=startIndex;
  // Punkt 9: Zeiger auf die erste Funding-Periode NACH Trade-Eröffnung; jede
  // Periode, die während der Haltedauer fällig wird, wird unten pro Bar
  // verrechnet, sobald deren Zeitstempel erreicht ist.
  let fundingIdx=0;
  while(fundingIdx<fundingHistory.length && fundingHistory[fundingIdx].time<=bars[startIndex].time) fundingIdx++;
  let fundingCostTotal=0;
  for(let i=startIndex;i<bars.length;i++){const b=bars[i];lastIndex=i;const hours=(b.time-bars[startIndex].time)/3600000;
    while(fundingIdx<fundingHistory.length && fundingHistory[fundingIdx].time<=b.time){
      const f=fundingHistory[fundingIdx];
      const notional=remaining*entry;
      const cost=signal.direction==='LONG'?f.fundingRate*notional:-f.fundingRate*notional;
      realized-=cost;fundingCostTotal+=cost;fundingIdx++;
    }
    if(!tp1Hit&&hours>=cfg.MAX_HOLD_HOURS){exitPrice=applySlippage(b.close,signal.direction,cfg.SLIPPAGE_PERCENT,'exit',cfg);realized+=(signal.direction==='LONG'?exitPrice-entry:entry-exitPrice)*remaining-fee(remaining*entry,cfg.FEE_PERCENT,cfg)-entryFee*(remaining/units);reason='time-stop';break;}
    if(tp1Hit&&hours>=cfg.ABSOLUTE_MAX_HOLD_HOURS){exitPrice=applySlippage(b.close,signal.direction,cfg.SLIPPAGE_PERCENT,'exit',cfg);realized+=(signal.direction==='LONG'?exitPrice-entry:entry-exitPrice)*remaining-fee(remaining*entry,cfg.FEE_PERCENT,cfg)-entryFee*(remaining/units);reason='absolute-time-limit';break;}
    if(tp1Hit){if(signal.direction==='LONG')highest=Math.max(highest,b.high);else lowest=Math.min(lowest,b.low);if(cfg.TRAILING_STOP_ENABLED){const atr=calculateATR(bars.slice(Math.max(0,i-20),i+1),14)||signal.atr;const cand=signal.direction==='LONG'?highest-atr*cfg.TRAILING_ATR_MULT:lowest+atr*cfg.TRAILING_ATR_MULT;if(signal.direction==='LONG')stop=Math.max(stop,cand);else stop=Math.min(stop,cand);}}
    // Conservative intrabar ordering: if both target and stop are touched, stop is assumed first.
    if(signal.direction==='LONG'){
      if(b.low<=stop){exitPrice=applySlippage(stop,'LONG',cfg.SLIPPAGE_PERCENT,'exit',cfg);realized+=(exitPrice-entry)*remaining-fee(remaining*entry,cfg.FEE_PERCENT,cfg)-entryFee*(remaining/units);reason=tp1Hit?'trailing-stop':'stop-loss';break;}
      if(!tp1Hit&&b.high>=tp1){const part=remaining*(cfg.TP1_CLOSE_PERCENT/100);const px=applySlippage(tp1,'LONG',cfg.SLIPPAGE_PERCENT,'exit',cfg);realized+=(px-entry)*part-fee(part*entry,cfg.FEE_PERCENT,cfg)-entryFee*(part/units);remaining-=part;tp1Hit=true;stop=entry;highest=px;}
      if(tp1Hit&&b.high>=tp2){exitPrice=applySlippage(tp2,'LONG',cfg.SLIPPAGE_PERCENT,'exit',cfg);realized+=(exitPrice-entry)*remaining-fee(remaining*entry,cfg.FEE_PERCENT,cfg)-entryFee*(remaining/units);reason='tp2';break;}
    } else {
      if(b.high>=stop){exitPrice=applySlippage(stop,'SHORT',cfg.SLIPPAGE_PERCENT,'exit',cfg);realized+=(entry-exitPrice)*remaining-fee(remaining*entry,cfg.FEE_PERCENT,cfg)-entryFee*(remaining/units);reason=tp1Hit?'trailing-stop':'stop-loss';break;}
      if(!tp1Hit&&b.low<=tp1){const part=remaining*(cfg.TP1_CLOSE_PERCENT/100);const px=applySlippage(tp1,'SHORT',cfg.SLIPPAGE_PERCENT,'exit',cfg);realized+=(entry-px)*part-fee(part*entry,cfg.FEE_PERCENT,cfg)-entryFee*(part/units);remaining-=part;tp1Hit=true;stop=entry;lowest=px;}
      if(tp1Hit&&b.low<=tp2){exitPrice=applySlippage(tp2,'SHORT',cfg.SLIPPAGE_PERCENT,'exit',cfg);realized+=(entry-exitPrice)*remaining-fee(remaining*entry,cfg.FEE_PERCENT,cfg)-entryFee*(remaining/units);reason='tp2';break;}
    }
  }
  if(lastIndex===bars.length-1&&reason==='end'){const b=bars.at(-1);exitPrice=applySlippage(b.close,signal.direction,cfg.SLIPPAGE_PERCENT,'exit',cfg);realized+=(signal.direction==='LONG'?exitPrice-entry:entry-exitPrice)*remaining-fee(remaining*entry,cfg.FEE_PERCENT,cfg)-entryFee*(remaining/units);}
  return {pnlUSD:realized,entry,exitPrice,reason,closeTime:bars[lastIndex].time,closeIndex:lastIndex,barsHeld:lastIndex-startIndex+1,tp1Hit,fundingCostUSD:fundingCostTotal,signal};}

function metrics(trades,startingCapital){const pnls=trades.map(t=>t.pnlUSD),wins=pnls.filter(x=>x>0),losses=pnls.filter(x=>x<0),net=pnls.reduce((a,b)=>a+b,0);let equity=startingCapital,peak=equity,maxDD=0;for(const p of pnls){equity+=p;peak=Math.max(peak,equity);maxDD=Math.max(maxDD,(peak-equity)/peak*100);}const grossWin=wins.reduce((a,b)=>a+b,0),grossLoss=Math.abs(losses.reduce((a,b)=>a+b,0));const returns=pnls.map(p=>p/startingCapital);const avg=returns.length?returns.reduce((a,b)=>a+b,0)/returns.length:0;const sd=returns.length?Math.sqrt(returns.reduce((a,r)=>a+Math.pow(r-avg,2),0)/returns.length):0;return {trades:trades.length,wins:wins.length,losses:losses.length,winRate:trades.length?wins.length/trades.length*100:0,netProfit:net,endingCapital:startingCapital+net,returnPct:net/startingCapital*100,maxDrawdownPct:maxDD,profitFactor:grossLoss?grossWin/grossLoss:Infinity,avgWin:wins.length?grossWin/wins.length:0,avgLoss:losses.length?losses.reduce((a,b)=>a+b,0)/losses.length:0,expectancy:trades.length?net/trades.length:0,sharpe:sd?avg/sd*Math.sqrt(96*365):0,bestTrade:pnls.length?Math.max(...pnls):0,worstTrade:pnls.length?Math.min(...pnls):0};}

const ONE_HOUR_MS=3600000, FOUR_HOUR_MS=14400000;

async function runBacktest({symbol='BTC-USDT',days=30,cfg=buildConfig(process.env),useML=cfg.BACKTEST_USE_ML,walkForward=true,logger=console,dataDir=null,btcDataDir=null}={}){
  logger.log(`📥 Lade ${symbol} 15m-Daten für ${days} Tage...`);
  let bars,btc;
  try{
    const loadLocal = (dir, sym) => {
      if (!dir) return null;
      const file = path.join(path.resolve(dir), sym, '15m.json');
      if (!fs.existsSync(file)) throw new Error(`Lokaler OHLCV-Datensatz fehlt: ${file}`);
      const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
      const rows = Array.isArray(payload) ? payload : payload.bars;
      if (!Array.isArray(rows)) throw new Error(`Ungültiges OHLCV-Format: ${file}`);
      return rows.map(c=>({time:Number(c.time),open:Number(c.open),high:Number(c.high),low:Number(c.low),close:Number(c.close),volume:Number(c.volume)})).filter(c=>Object.values(c).every(Number.isFinite)).sort((a,b)=>a.time-b.time);
    };
    const localBars = loadLocal(dataDir, symbol);
    const localBtc = loadLocal(btcDataDir || dataDir, 'BTC-USDT');
    [bars,btc]=await Promise.all([
      localBars || fetchKucoinCandles(symbol,'15m',days),
      symbol==='BTC-USDT' ? Promise.resolve([]) : (localBtc || fetchKucoinCandles('BTC-USDT','15m',days))
    ]);
  }catch(e){
    throw new Error(`${dataDir ? 'Lokale/KuCoin-Daten' : 'KuCoin-Daten'} fehlgeschlagen für ${symbol}: ${e.message}`);
  }
  if(!bars||bars.length<cfg.BACKTEST_WARMUP_BARS+100)throw new Error(`Zu wenige 15m-Kerzen: ${bars?.length||0}`);
  const btcBars=btc&&btc.length?btc:bars;
  // Punkt 9: historische Funding-Raten für den gesamten Backtest-Zeitraum
  // einmalig laden. Schlägt der Abruf fehl, fällt der Backtest auf 0
  // (bisheriges Verhalten) zurück statt komplett abzubrechen.
  let fundingHistory=[];
  try{
    fundingHistory=await fetchHistoricalFunding(symbol,bars[0].time,bars.at(-1).time+ONE_HOUR_MS);
    logger.log(`💰 ${fundingHistory.length} historische Funding-Perioden geladen.`);
  }catch(e){
    if (cfg.REQUIRE_FUNDING_HISTORY) throw new Error(`Historische Funding-Daten fehlen: ${e.message}`);
    logger.error?.(`[Backtest] Funding-Daten-Abruf fehlgeschlagen; nur mit REQUIRE_FUNDING_HISTORY=false wird Funding=0 verwendet: ${e.message}`);
  }
  const trades=[], trainingRecords=[];let equity=cfg.BACKTEST_STARTING_CAPITAL, dailyPnL=0,lastDay='',active=null,model=new TensorFlowSignalModel({minSamples:cfg.ML_MIN_TRAINING_SAMPLES,epochs:cfg.ML_EPOCHS,batchSize:cfg.ML_BATCH_SIZE,minPredictionProbability:cfg.ML_MIN_PREDICTION_PROBABILITY,logger});let mlAccepted=0,mlBlocked=0,signals=0,rawCandidates=0,mlRetrains=0;
  let lastWalkForwardTestBucket=null;
  const tf1h=aggregate(bars,4),tf4h=aggregate(bars,16),btc1h=aggregate(btcBars,4),btc4h=aggregate(btcBars,16);
  const warm=cfg.BACKTEST_WARMUP_BARS;
  for(let i=warm;i<bars.length-1;i++){
    const bar=bars[i];const day=new Date(bar.time).toISOString().slice(0,10);if(day!==lastDay){lastDay=day;dailyPnL=0;}
    const c15=bars.slice(0,i+1);
    // Data-leakage fix: tf1h/tf4h are pre-aggregated once over the whole
    // dataset with `time` = OPEN of the HTF candle. A candle whose open time
    // merely precedes the current bar (`c.time<=bar.time`) may still be
    // in-progress relative to "now" - only a candle that has fully closed
    // (c.time + timeframeMs <= bar.time) may be used, otherwise the model
    // sees information from HTF candles that haven't finished forming yet.
    const c1=tf1h.filter(c=>c.time+ONE_HOUR_MS<=bar.time);
    const c4=tf4h.filter(c=>c.time+FOUR_HOUR_MS<=bar.time);
    const bcEnd = lastBarIndexAtOrBefore(btcBars, bar.time); const bc = bcEnd >= 0 ? btcBars.slice(0, bcEnd + 1) : [];const snap=buildSnapshot(c15,c1,c4,bc,cfg);if(!snap.poc||!snap.vwap||!snap.atr)continue;const sig=candidate(snap,cfg);if(!sig)continue;rawCandidates++;
    const nextIndex=i+1;sig.entry=bars[nextIndex].open;signals++;
    let accepted=true,prob=.5;
    if(useML&&walkForward){
      try{
        const testBucket=Math.floor(bar.time/(cfg.BACKTEST_TEST_DAYS*86400000));
        if(lastWalkForwardTestBucket===null || testBucket!==lastWalkForwardTestBucket){
          lastWalkForwardTestBucket=testBucket;
          const trainCutoff=bar.time;
          const purgeCutoff=trainCutoff-cfg.BACKTEST_PURGE_DAYS*86400000;
          const trainStart=trainCutoff-cfg.BACKTEST_TRAIN_DAYS*86400000;
          const rollingTrainingRecords=trainingRecords.filter(r=>r.closeTime<purgeCutoff && r.closeTime>=trainStart);
          if(rollingTrainingRecords.length>=cfg.ML_MIN_TRAINING_SAMPLES){
            if(await trainModelFromRecords(model,rollingTrainingRecords,cfg))mlRetrains++;
          }
        }
        if(model.trained){
          const f=tradeFeatures(model,sig),pred=predictWith(model,f);
          prob=pred.probability;
          if(prob<cfg.ML_MIN_PREDICTION_PROBABILITY){accepted=false;mlBlocked++;}else mlAccepted++;
        }
      }catch(e){
        logger.error?.(`[Backtest] ML-Schritt fehlgeschlagen bei Bar ${i}: ${e.message}`);
        accepted=false; mlBlocked++; prob=.5;
      }
    }
    if(!accepted)continue;
    // Enforce simple one-position-at-a-time and daily loss protection for a conservative single-symbol backtest.
    if(dailyPnL<=-cfg.MAX_DAILY_LOSS_USD)continue;
    const result=simulateSignal(sig,bars,nextIndex,cfg,fundingHistory);result.signal.mlProbability=prob;trades.push(result);dailyPnL+=result.pnlUSD;equity+=result.pnlUSD;trainingRecords.push(makeModelRecord(result.signal,result.pnlUSD,result.closeTime));i=result.closeIndex;
  }
  const m=metrics(trades,cfg.BACKTEST_STARTING_CAPITAL);return {symbol,days,dataBars:bars.length,dataLimitations:['Historical KuCoin OHLCV only',fundingHistory.length?`Historical funding rates applied (${fundingHistory.length} periods)`:'Funding rate history unavailable, assumed 0','Historical orderbook imbalance is unavailable and assumed neutral','Intrabar ordering uses conservative stop-first when SL and TP occur in the same candle'],signals,rawCandidates,tradeCount:trades.length,mlAccepted,mlBlocked,mlRetrains,mlEnabled:useML,metrics:m,trades:trades.map(t=>({time:new Date(t.signal.entryTime||t.closeTime).toISOString(),direction:t.signal.direction,entry:t.entry,exit:t.exitPrice,pnlUSD:t.pnlUSD,reason:t.reason,mlProbability:t.signal.mlProbability||.5,signalScore:t.signal.signalScore}))};
}

async function optimizeHyperparameters(symbol, days, baseConfig) {
  // Random Search: deutlich breiter als der alte 3x3-Grid und inkl. TP1/TP2.
  // Ein fester Seed macht die Suche reproduzierbar, ohne den Suchraum zu
  // deterministisch auf wenige Randwerte zu beschränken.
  const samples = Math.max(50, Number(baseConfig.HYPERPARAM_SEARCH_SAMPLES || 60));
  let seed = 0x9e3779b9;
  const rand = () => {
    seed |= 0;
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const uniform = (min, max) => min + rand() * (max - min);

  let bestScore = -Infinity;
  let bestParams = null;

  console.log(`🔍 Starte Random-Search für ${symbol}: ${samples} Kombinationen...`);

  for (let i = 0; i < samples; i++) {
    const learningRate = 10 ** uniform(Math.log10(0.0001), Math.log10(0.01));
    const atrMultiplier = uniform(1.8, 3.0);
    const adxMin = uniform(15, 30);
    const tp1Multiplier = uniform(1.0, 2.4);
    const tp2Multiplier = uniform(Math.max(tp1Multiplier + 0.4, 1.8), 4.0);

    const testConfig = {
      ...baseConfig,
      ML_LEARNING_RATE: learningRate,
      ATR_STOP_MULT: atrMultiplier,
      ADX_MIN: adxMin,
      TP1_MULT: tp1Multiplier,
      TP2_MULT: tp2Multiplier
    };

    try {
      const result = await runBacktest({ symbol, days, cfg: testConfig, useML: true, walkForward: false });
      const metrics = result.metrics;

      // Sharpe + Profit, mit leichtem Drawdown-Penalty gegen überangepasste Runs.
      const drawdownPenalty = Number.isFinite(metrics.maxDrawdownPct) ? metrics.maxDrawdownPct * 0.15 : 0;
      const score = (metrics.sharpe * 2) +
        (metrics.netProfit > 0 ? metrics.netProfit / 100 : -10) -
        drawdownPenalty;

      if (score > bestScore) {
        bestScore = score;
        bestParams = {
          learningRate,
          atrMultiplier,
          adxMin,
          tp1Multiplier,
          tp2Multiplier,
          score,
          metrics
        };
        console.log(`🔬 #${i + 1}/${samples}: neuer Bestwert ${score.toFixed(3)}`);
      }
    } catch (e) {
      // Fehlerhafte Kombinationen nicht die gesamte Suche abbrechen lassen.
    }
  }

  console.log(`✅ Random-Search abgeschlossen. Beste Parameter:`, bestParams);
  return bestParams;
}

module.exports = { runBacktest, fetchKucoinCandles, fetchHistoricalFunding, buildConfig, metrics, optimizeHyperparameters };
