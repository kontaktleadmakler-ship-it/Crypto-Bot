'use strict';
function n(v,d=0){const x=Number(v);return Number.isFinite(x)?x:d}
function mean(a){return a.length?a.reduce((x,y)=>x+y,0)/a.length:0}
function stdev(a){if(a.length<2)return 0;const m=mean(a);return Math.sqrt(mean(a.map(x=>(x-m)**2)))}
function quantile(a,q){if(!a.length)return 0;const s=[...a].sort((x,y)=>x-y),p=(s.length-1)*q,i=Math.floor(p),f=p-i;return s[i]+(s[i+1]-s[i]||0)*f}
class InstitutionalBacktestEngine{
 constructor({initialEquity=100000,feeBps=4,slippageBps=2,fundingBpsPer8h=0,maintenanceMarginRate=.005,leverage=3}={}){this.cfg={initialEquity,feeBps,slippageBps,fundingBpsPer8h,maintenanceMarginRate,leverage}}
 _fillPrice(c,side){const slip=n(c.close)*(this.cfg.slippageBps/10000);return side==='BUY'?n(c.close)+slip:n(c.close)-slip}
 _maxDD(e){let peak=-Infinity,m=0;for(const x of e){peak=Math.max(peak,x);m=Math.max(m,peak-x)}return m}
 _maxDDPct(e){let peak=-Infinity,m=0;for(const x of e){peak=Math.max(peak,x);if(peak)m=Math.max(m,(peak-x)/peak)}return m}
 _metrics(trades,equity){const rets=[];for(let i=1;i<equity.length;i++)if(equity[i-1])rets.push(equity[i]/equity[i-1]-1);const pnl=trades.map(t=>t.netPnl),wins=pnl.filter(x=>x>0),losses=pnl.filter(x=>x<0),dd=this._maxDD(equity),ddPct=this._maxDDPct(equity),sd=stdev(rets),down=stdev(rets.filter(x=>x<0));return {trades:trades.length,winrate:trades.length?wins.length/trades.length:0,profitFactor:losses.length?wins.reduce((a,b)=>a+b,0)/Math.abs(losses.reduce((a,b)=>a+b,0)):(wins.length?Infinity:0),expectancy:mean(pnl),maxDrawdown:dd,maxDrawdownPct:ddPct,sharpe:sd?mean(rets)/sd*Math.sqrt(252):0,sortino:down?mean(rets)/down*Math.sqrt(252):0,calmar:ddPct?(equity.at(-1)/equity[0]-1)/ddPct:0,marRatio:ddPct?(equity.at(-1)/equity[0]-1)/ddPct:0,totalPnl:equity.at(-1)-equity[0],returnPct:(equity.at(-1)/equity[0]-1)*100}}
 run({candles=[],strategy,signals=[],timeframes={},symbol='BTCUSDT'}={}){
  let equity=this.cfg.initialEquity,cash=equity,pos=null,trades=[],curve=[equity],funding=0;
  const sigByTime=new Map(signals.map(s=>[Number(s.time||s.ts),s]));
  for(let i=0;i<candles.length;i++){
   const c=candles[i],t=Number(c.time||c.timestamp||i),s=strategy?strategy(c,i,{position:pos,equity}):sigByTime.get(t);
   if(pos){
    const dir=pos.side==='LONG'?1:-1, raw=(n(c.close)-pos.entry)*dir*pos.qty, notional=n(c.close)*pos.qty;
    funding+=notional*(this.cfg.fundingBpsPer8h/10000)*(i%8===0?1:0);
    equity=this.cfg.initialEquity+trades.reduce((a,x)=>a+x.netPnl,0)+raw-funding;
    const hitStop=pos.stop!=null&&(dir>0?c.low<=pos.stop:c.high>=pos.stop),hitTp=pos.tp!=null&&(dir>0?c.high>=pos.tp:c.low<=pos.tp);
    if(hitStop||hitTp||s?.exit){
     const exitPrice=hitStop?n(pos.stop):hitTp?n(pos.tp):n(c.close),gross=(exitPrice-pos.entry)*dir*pos.qty,entryFee=pos.entry*pos.qty*this.cfg.feeBps/10000,exitFee=exitPrice*pos.qty*this.cfg.feeBps/10000,net=gross-entryFee-exitFee;
     trades.push({symbol,side:pos.side,entryTime:pos.time,exitTime:t,entry:pos.entry,exit:exitPrice,qty:pos.qty,grossPnl:gross,fees:entryFee+exitFee,netPnl:net,holdingBars:i-pos.index,reason:hitStop?'SL':hitTp?'TP':'SIGNAL'});
     cash+=net;pos=null;equity=cash-funding;
    }
   }
   if(!pos&&s&&!s.exit&&['LONG','SHORT'].includes(String(s.side||'').toUpperCase())){
    const side=String(s.side).toUpperCase(),qty=n(s.qty||s.quantity||1),entry=this._fillPrice(c,side==='LONG'?'BUY':'SELL');
    pos={side,qty,entry,time:t,index:i,stop:Number.isFinite(Number(s.stop))?Number(s.stop):null,tp:Number.isFinite(Number(s.tp))?Number(s.tp):null};
   }
   curve.push(equity);
  }
  if(pos){
   const c=candles.at(-1),dir=pos.side==='LONG'?1:-1,exit=n(c.close),gross=(exit-pos.entry)*dir*pos.qty,fees=(pos.entry+exit)*pos.qty*this.cfg.feeBps/10000;
   trades.push({symbol,side:pos.side,entryTime:pos.time,exitTime:n(c.time||c.timestamp),entry:pos.entry,exit,qty:pos.qty,grossPnl:gross,fees,netPnl:gross-fees,holdingBars:candles.length-1-pos.index,reason:'END'});
   cash+=gross-fees;equity=cash-funding;curve[curve.length-1]=equity;
  }
  return {symbol,initialEquity:this.cfg.initialEquity,finalEquity:equity,equityCurve:curve,trades,metrics:{...this._metrics(trades,curve),fees:trades.reduce((a,t)=>a+t.fees,0),fundingFees:funding},config:this.cfg,timeframes};
 }
 multiTimeframe({baseCandles,frames,signalFn,...opts}){return this.run({candles:baseCandles,strategy:(c,i,ctx)=>signalFn(c,i,ctx,frames||{}),...opts,timeframes:Object.keys(frames||{})})}
}
module.exports={InstitutionalBacktestEngine,mean,stdev,quantile};
