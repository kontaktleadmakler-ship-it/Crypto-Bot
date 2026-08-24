'use strict';
class SafetyController {
  constructor({logger=console}={}){this.logger=logger;this.states=new Map();this.reason='startup';}
  set(name,enabled,reason='manual'){this.states.set(String(name),Boolean(enabled));if(enabled)this.reason=reason;return this.snapshot();}
  isActive(name){return this.states.get(String(name))===true;}
  isTradingAllowed(){return ![...this.states.values()].some(Boolean);}
  assertTradingAllowed(){if(!this.isTradingAllowed())throw new Error(`TRADING_HALTED:${this.reason}`);return true;}
  snapshot(){return {tradingAllowed:this.isTradingAllowed(),reason:this.reason,states:Object.fromEntries(this.states)};}
}
module.exports={SafetyController};
