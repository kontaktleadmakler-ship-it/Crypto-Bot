'use strict';
class PortfolioLedger {
  constructor({logger=console}={}){this.logger=logger;this.events=[];this.realizedPnL=0;this.fees=0;this.funding=0;}
  append(event){
    if(!event?.eventId) throw new Error('LEDGER_EVENT_ID_REQUIRED');
    if(this.events.some(e=>e.eventId===event.eventId)) return {duplicate:true,event:this.events.find(e=>e.eventId===event.eventId)};
    const e={...event,timestamp:event.timestamp||Date.now()};
    this.events.push(e); this.realizedPnL+=Number(e.realizedPnLUSD||0); this.fees+=Number(e.feeUSD||0); this.funding+=Number(e.fundingUSD||0);
    return {duplicate:false,event:e};
  }
  snapshot(){return {events:this.events.length,realizedPnLUSD:this.realizedPnL,feesUSD:this.fees,fundingUSD:this.funding,netPnLUSD:this.realizedPnL-this.fees-this.funding};}
}
module.exports={PortfolioLedger};
