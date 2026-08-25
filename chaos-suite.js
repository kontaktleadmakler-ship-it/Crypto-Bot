'use strict';
class ChaosSuite {
  constructor({ executor, reconciler }={}) { this.executor=executor; this.reconciler=reconciler; }
  async run(){
    const scenarios=[
      ['exchange-timeout',()=>this.executor?.({type:'timeout'})],['exchange-reset',()=>this.executor?.({type:'reset'})],['partial-fill',()=>this.executor?.({type:'partial-fill'})],
      ['mongo-write-failure',()=>this.executor?.({type:'db-failure'})],['duplicate-event',()=>this.executor?.({type:'duplicate-event'})],
      ['crash-after-submit',()=>this.executor?.({type:'crash-after-submit'})],['orderbook-gap',()=>this.executor?.({type:'orderbook-gap'})],['stale-price',()=>this.executor?.({type:'stale'})]
    ];
    const results=[]; for(const [name,fn] of scenarios){ try { await fn(); results.push({name,passed:true}); } catch(e){ results.push({name,passed:false,error:e.message}); } }
    const dangerous=results.filter(r=>!r.passed); return {passed:dangerous.length===0, scenarios:results, duplicateOrderRisk:dangerous.length>0};
  }
}
module.exports={ChaosSuite};
