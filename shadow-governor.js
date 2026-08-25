'use strict';
class ShadowGovernor {
  constructor(){this.enabled=true;this.decisions=0;}
  evaluate({expectedPosition={},actualPosition={},riskState='NORMAL'}={}){
    this.decisions++; const diffs={}; const keys=new Set([...Object.keys(expectedPosition),...Object.keys(actualPosition)]); for(const k of keys) diffs[k]=Number(expectedPosition[k]||0)-Number(actualPosition[k]||0); const mismatch=Object.values(diffs).some(v=>Math.abs(v)>1e-12); return {allowedToSubmit:false,mismatch,diffs,riskState,decisionCount:this.decisions};
  }
}
module.exports={ShadowGovernor};
