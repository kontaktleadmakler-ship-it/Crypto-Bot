'use strict';
class ModelGovernance {
  constructor({ driftThreshold=.35, minOos=.55 }={}) { this.driftThreshold=driftThreshold; this.minOos=minOos; this.active=null; this.previous=null; }
  register(stats={}) { if(!stats.modelVersion) throw new Error('MODEL_VERSION_REQUIRED'); this.previous=this.active; this.active={...stats, registeredAt:new Date().toISOString()}; return this.active; }
  validateForProduction(stats={}) { return Boolean(stats.modelVersion && Number(stats.validationAccuracy)>=this.minOos && Number(stats.validationBalancedAccuracy||0)>=this.minOos); }
  evaluateDrift({score=0}={}) { const halted=Number(score)>=this.driftThreshold; return {halted,score,threshold:this.driftThreshold,reason:halted?'MODEL_DRIFT':'OK'}; }
  rollback() { if(!this.previous) throw new Error('NO_MODEL_ROLLBACK_AVAILABLE'); const old=this.active; this.active=this.previous; this.previous=old; return this.active; }
}
module.exports={ModelGovernance};
