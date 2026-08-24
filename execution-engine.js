'use strict';
class ExecutionEngine {
  constructor({dryRun=true,enabled=false,killSwitch=true}={}){this.dryRun=dryRun!==false;this.enabled=enabled===true;this.killSwitch=killSwitch!==false;this.orders=new Map();}
  createOrder(order){if(!order?.clientOrderId)throw new Error('clientOrderId required');if(this.orders.has(order.clientOrderId))return this.orders.get(order.clientOrderId);const r={...order,status:(this.dryRun||!this.enabled||this.killSwitch)?'SIMULATED':'NEW',mode:this.dryRun?'DRY_RUN':'LIVE',createdAt:new Date().toISOString()};this.orders.set(r.clientOrderId,r);return r;}
  cancelAll(){for(const o of this.orders.values())if(['NEW','PARTIALLY_FILLED'].includes(o.status))o.status='CANCEL_REQUESTED';return [...this.orders.values()];}
  status(){return {dryRun:this.dryRun,enabled:this.enabled,killSwitch:this.killSwitch,orders:[...this.orders.values()]};}
}
module.exports={ExecutionEngine};
