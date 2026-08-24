'use strict';
/** Production readiness gate. It intentionally fails closed. */
class ProductionReadinessGate {
  constructor({required=[]}={}){this.required=required;}
  evaluate(input={}){
    const checks={}; for(const key of this.required) checks[key]=Boolean(input[key]);
    const failed=Object.entries(checks).filter(([,v])=>!v).map(([k])=>k);
    return {ready:failed.length===0,checks,failed,mode:failed.length?'PAPER_SHADOW_ONLY':'PRODUCTION_ELIGIBLE'};
  }
}
module.exports={ProductionReadinessGate};
