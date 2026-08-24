'use strict';
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');

/**
 * B13 deterministic replay engine.
 * Replays SIGNAL/ORDER/FILL/TP/SL/CLOSE/CANDLE events without network access.
 */
class ExecutionReplayEngine {
  constructor({dir='./data/execution-journal',initialState=null}={}) {
    this.dir=dir; this.initialState=initialState || this.emptyState();
  }
  emptyState(){
    return {positions:{},orders:{},fills:[],signals:[],candles:[],eventsApplied:0,lastSeq:0};
  }
  _clone(v){return JSON.parse(JSON.stringify(v));}
  _apply(s,e){
    switch(e.type){
      case 'SIGNAL': s.signals.push(this._clone(e)); break;
      case 'CANDLE': s.candles.push(this._clone(e)); break;
      case 'ORDER': s.orders[e.orderId]=this._clone(e); break;
      case 'FILL': {
        if(s.fills.some(x=>x.fillId===e.fillId)) break;
        s.fills.push(this._clone(e));
        const p=s.positions[e.symbol] || {symbol:e.symbol,side:e.side,qty:0,avgPrice:0,realizedPnl:0};
        const qty=Number(e.qty||e.quantity||0), price=Number(e.price||0);
        const oldQty=Number(p.qty||0);
        const signed=(String(e.side).toUpperCase()==='SELL'?-1:1)*qty;
        if(oldQty===0 || Math.sign(oldQty)===Math.sign(signed)){
          const newQty=oldQty+signed;
          p.avgPrice=newQty ? ((Math.abs(oldQty)*Number(p.avgPrice||0))+(Math.abs(signed)*price))/Math.abs(newQty) : 0;
          p.qty=newQty;
        } else {
          const closing=Math.min(Math.abs(oldQty),Math.abs(signed));
          const pnl=(price-Number(p.avgPrice||0))*closing*(oldQty>0?1:-1);
          p.realizedPnl=Number(p.realizedPnl||0)+pnl;
          p.qty=oldQty+signed;
          if(p.qty!==0 && Math.sign(p.qty)!==Math.sign(oldQty)) p.avgPrice=price;
        }
        if(p.qty===0) delete s.positions[e.symbol]; else s.positions[e.symbol]=p;
        break;
      }
      case 'TP':
      case 'SL':
      case 'CLOSE': delete s.positions[e.symbol]; break;
      default: break;
    }
    s.eventsApplied++; s.lastSeq=Number(e.seq||s.lastSeq);
  }
  replay(events,{verifySequence=true}={}) {
    const s=this._clone(this.initialState);
    let expected=1;
    for(const e of events){
      if(verifySequence && e.seq!==undefined && Number(e.seq)!==expected)
        throw new Error(`MISSING_EVENT: expected sequence ${expected}, got ${e.seq}`);
      this._apply(s,e); if(e.seq!==undefined) expected++;
    }
    return s;
  }
  replayDay(day,{verifySequence=true}={}) {
    const file=path.join(this.dir,`${day}.jsonl`);
    if(!fs.existsSync(file)) return this._clone(this.initialState);
    const events=fs.readFileSync(file,'utf8').split('\n').filter(Boolean).map(JSON.parse);
    return this.replay(events,{verifySequence});
  }
  stateHash(state){
    return crypto.createHash('sha256').update(JSON.stringify(state)).digest('hex');
  }
}
module.exports=ExecutionReplayEngine;
