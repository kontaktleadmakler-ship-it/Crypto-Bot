'use strict';
const crypto=require('crypto');

function stable(v){return JSON.stringify(v);}
function hash(v){return crypto.createHash('sha256').update(stable(v)).digest('hex');}

class ReplayValidationSuite {
  static compareState(live,replay){
    const a=stable(live), b=stable(replay);
    return {identical:a===b,liveHash:hash(live),replayHash:hash(replay)};
  }
  static validateReplayParity(live,replay){ return this.compareState(live,replay).identical; }
  static missingEvents(events){
    const seq=events.map(e=>Number(e.seq)).filter(Number.isFinite).sort((a,b)=>a-b);
    const missing=[]; for(let i=1;i<seq.length;i++) for(let n=seq[i-1]+1;n<seq[i];n++) missing.push(n);
    return missing;
  }
  static duplicateFills(events){
    const seen=new Set(), duplicates=[];
    for(const e of events.filter(x=>x.type==='FILL')){
      if(seen.has(e.fillId)) duplicates.push(e.fillId); else seen.add(e.fillId);
    }
    return duplicates;
  }
  static validate(events,finalState,replayedState){
    const parity=this.compareState(finalState,replayedState);
    return {
      ok: parity.identical && this.missingEvents(events).length===0 && this.duplicateFills(events).length===0,
      parity, missingEvents:this.missingEvents(events), duplicateFills:this.duplicateFills(events)
    };
  }
}
module.exports=ReplayValidationSuite;
