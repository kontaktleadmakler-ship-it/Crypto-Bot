'use strict';
function mean(a){return a.length?a.reduce((x,y)=>x+y,0)/a.length:0;}
class ConceptDriftMonitor {
  constructor({ window=200, threshold=0.35 }={}){this.window=window;this.threshold=threshold;this.history=[];}
  add(probability, outcome){this.history.push({probability:Number(probability), outcome:Number(outcome)});if(this.history.length>this.window*2)this.history.shift();}
  score(){if(this.history.length<this.window*2/1.5)return 0;const mid=Math.floor(this.history.length/2);const a=this.history.slice(0,mid),b=this.history.slice(mid);const ea=mean(a.map(x=>Math.abs(x.probability-x.outcome))),eb=mean(b.map(x=>Math.abs(x.probability-x.outcome)));return Math.abs(eb-ea);}
  status(){const score=this.score();return {drift:score>=this.threshold,score,recommendation:score>=this.threshold?'FULL_RETRAIN':'INCREMENTAL_OR_HOLD'};}
}
module.exports = { ConceptDriftMonitor };
