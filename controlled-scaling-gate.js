'use strict';
const ORDER=['PAPER','SHADOW','TINY_LIVE','CONTROLLED_LIVE'];
class ControlledScalingGate {
  constructor({liveEnabled=false,maxLiveNotional=0}={}){this.liveEnabled=!!liveEnabled;this.maxLiveNotional=Number(maxLiveNotional||0);}
  evaluate({stage='PAPER',readiness=false,killSwitch=true,chaosPassed=false,shadowPassed=false,paperPassed=false,notional=0}={}){
    const idx=ORDER.indexOf(stage); const checks={paperPassed,shadowPassed,chaosPassed,killSwitch,readiness,liveEnabled:this.liveEnabled,notionalWithinLimit:Number(notional)<=this.maxLiveNotional};
    let allowed=false; if(stage==='PAPER') allowed=paperPassed; else if(stage==='SHADOW') allowed=shadowPassed&&killSwitch; else if(stage==='TINY_LIVE') allowed=this.liveEnabled&&readiness&&paperPassed&&shadowPassed&&chaosPassed&&killSwitch&&checks.notionalWithinLimit; else if(stage==='CONTROLLED_LIVE') allowed=this.liveEnabled&&readiness&&paperPassed&&shadowPassed&&chaosPassed&&killSwitch&&checks.notionalWithinLimit;
    return {stage,stageIndex:idx,allowed,checks};
  }
  assert(stage,ctx){const r=this.evaluate({stage,...ctx}); if(!r.allowed) throw new Error(`SCALING_GATE_BLOCKED:${stage}`); return true;}
}
module.exports={ControlledScalingGate,ORDER};
