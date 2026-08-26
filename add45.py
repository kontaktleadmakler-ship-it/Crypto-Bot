from pathlib import Path
p=Path('/mnt/data/j45/trading-bot-v24.6-runtime.js')
s=p.read_text()
needle="const { TimesFMForecastAgent } = require('./timesfm-forecast-agent');"
if "const { MonteCarloEngine } = require('./monte-carlo-engine');" not in s:
    s=s.replace(needle, needle+"\nconst { MonteCarloEngine } = require('./monte-carlo-engine');")
marker="app.get('/api/dashboard/historical/status', (req, res) => {"
idx=s.index(marker)
# insert endpoint before status
endpoint=r'''
// ============================================================================
// JARVIS 4.5 — WALK-FORWARD / OOS / MONTE-CARLO INTELLIGENCE
// Read-only analytics over recorded market-data events. No live state mutation.
// ============================================================================
const jarvisBacktestCache = { ts: 0, key: '', data: null };
function jarvisHistPrice(e) {
  const p = e?.payload || e?.data || {};
  const candidates = [p.price, p.close, p.last, p.markPrice, p.market?.price, p.market?.close, e?.price];
  for (const v of candidates) { const n = Number(v); if (Number.isFinite(n) && n > 0) return n; }
  return null;
}
function jarvisHistAction(e) {
  const p = e?.payload || {};
  return String(p.action || p.finalAction || p.recommendation || p.decision || '').toUpperCase();
}
function jarvisBacktestMetrics(values) {
  const xs = values.filter(Number.isFinite);
  if (!xs.length) return { count: 0, totalReturn: 0, winRate: 0, sharpe: 0, maxDrawdown: 0 };
  let eq=1, peak=1, mdd=0, wins=0, sum=0, sq=0;
  for (const r of xs) { eq*=1+r; peak=Math.max(peak,eq); mdd=Math.max(mdd,(peak-eq)/peak); if(r>0)wins++; sum+=r; sq+=r*r; }
  const mean=sum/xs.length, variance=Math.max(0,sq/xs.length-mean*mean);
  return { count:xs.length, totalReturn:(eq-1)*100, winRate:wins/xs.length*100, sharpe:variance>0?mean/Math.sqrt(variance)*Math.sqrt(xs.length):0, maxDrawdown:mdd*100 };
}

app.get('/api/dashboard/backtest-intelligence', async (req, res) => {
  try {
    const now=Date.now(), from=Number.isFinite(Number(req.query.from))?Number(req.query.from):now-7*86400000, to=Number.isFinite(Number(req.query.to))?Number(req.query.to):now;
    const symbol=String(req.query.symbol||'').toUpperCase();
    const trainSize=Math.max(20,Math.min(1000,Number(req.query.trainSize||120)));
    const testSize=Math.max(10,Math.min(500,Number(req.query.testSize||40)));
    const stepSize=Math.max(1,Math.min(500,Number(req.query.stepSize||40)));
    const purgeSize=Math.max(0,Math.min(100,Number(req.query.purgeSize||2)));
    const embargoSize=Math.max(0,Math.min(100,Number(req.query.embargoSize||2)));
    const key=[from,to,symbol,trainSize,testSize,stepSize,purgeSize,embargoSize].join(':');
    if(jarvisBacktestCache.data && jarvisBacktestCache.key===key && now-jarvisBacktestCache.ts<5000) return res.json(jarvisBacktestCache.data);
    const events=[];
    await jarvisHistoricalReplay.run({fromTs:from,toTs:to,onEvent:async e=>{ if(!symbol || String(e.symbol||'').toUpperCase()===symbol) events.push(e); }});
    events.sort((a,b)=>a.ts-b.ts);
    const pricesBySymbol=new Map();
    for(const e of events){const sym=String(e.symbol||'').toUpperCase(); const price=jarvisHistPrice(e); if(!sym||!price)continue; if(!pricesBySymbol.has(sym))pricesBySymbol.set(sym,[]); pricesBySymbol.get(sym).push({ts:e.ts,price});}
    const returns=[];
    for(const [sym,arr] of pricesBySymbol){let prev=null; for(const x of arr){if(prev && x.price>0){returns.push({ts:x.ts,symbol:sym,ret:x.price/prev-1,price:x.price});} prev=x.price;}}
    returns.sort((a,b)=>a.ts-b.ts);
    const series=returns.map(x=>x.ret);
    const splits=splitWalkForward(series,{trainSize,testSize,purgeSize,embargoSize,stepSize});
    const windows=splits.map((w,i)=>({index:i,train:{...jarvisBacktestMetrics(w.train)},test:{...jarvisBacktestMetrics(w.test)},purge:w.purge.length,embargo:w.embargo.length}));
    const oos=jarvisBacktestMetrics(splits.flatMap(w=>w.test));
    const inSample=jarvisBacktestMetrics(splits.flatMap(w=>w.train));
    const degradation=inSample.sharpe-oos.sharpe;
    const mcTrades=returns.slice(-Math.min(500,returns.length)).map((x,i)=>({id:i,netPnl:x.ret*100000}));
    const mc=new MonteCarloEngine({runs:Math.min(3000,Math.max(250,Number(req.query.mcRuns||1000))),seed:42}).run(mcTrades,{initialEquity:100000});
    const actionCounts={}; const decisionEvents=[];
    for(const e of events){const a=jarvisHistAction(e); if(a){actionCounts[a]=(actionCounts[a]||0)+1; if(/BUY|SELL|LONG|SHORT|HOLD/.test(a))decisionEvents.push({ts:e.ts,symbol:e.symbol,action:a});}}
    const result={timestamp:now,mode:'READ_ONLY_BACKTEST_INTELLIGENCE',range:{from,to},filter:{symbol:symbol||'ALL'},dataset:{events:events.length,pricePoints:returns.length,symbols:[...pricesBySymbol.keys()]},configuration:{trainSize,testSize,stepSize,purgeSize,embargoSize,mcRuns:mc.runs},inSample,oos,degradation,windows,monteCarlo:{runs:mc.runs,summary:mc.summary},actions:actionCounts,decisions:decisionEvents.slice(-100),governance:{liveExecutionTouched:false,modelPromotionAllowed:false}};
    jarvisBacktestCache.ts=now; jarvisBacktestCache.key=key; jarvisBacktestCache.data=result; res.setHeader('Cache-Control','no-store'); res.json(result);
  } catch(err){res.status(500).json({error:'BACKTEST_INTELLIGENCE_FAILED',message:err.message,liveExecutionTouched:false});}
});

'''
s=s[:idx]+endpoint+s[idx:]
p.write_text(s)
