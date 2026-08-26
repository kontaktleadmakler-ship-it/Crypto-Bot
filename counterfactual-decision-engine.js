'use strict';
/** JARVIS 6.5 — Counterfactual Decision Engine
 * Read-only scenario analysis. It never executes, mutates weights, or promotes models.
 */
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,Number(v)||0));
const normalizeAction=a=>String(a||'MONITOR').toUpperCase().replace('VERKAUFEN','SELL').replace('KAUFEN','BUY');
function evaluateScenario(action,{agents=[],router={},portfolio={},risk={},dqn={}}={}){
  const a=normalizeAction(action); const vetoes=agents.filter(x=>/VETO|BLOCK/i.test(String(x.status||'')));
  const riskScore=clamp(Number(risk.score ?? portfolio.riskScore ?? 0.5));
  const consensus=clamp(Number(router.confidence||0)/100);
  const dqnDecision=normalizeAction(dqn.decision);
  const dqnAlign=(a==='MONITOR'||a==='BLOCK'||dqnDecision==='MONITOR')?0.5:(a===dqnDecision?1:0);
  const directionalRisk=(a==='BUY'||a==='SELL'||a==='LONG'||a==='SHORT')?riskScore:0.15;
  const vetoPenalty=vetoes.length?0.45:0;
  const confidence=Math.round(clamp(0.35*consensus+0.25*dqnAlign+0.25*(1-directionalRisk)+0.15*(1-vetoPenalty))*100);
  const expectedEdge=+( (confidence/100-0.5)*2 ).toFixed(4);
  const hardBlock=vetoes.length>0 && a!=='MONITOR';
  const riskLevel=hardBlock?'BLOCKED':directionalRisk>0.75?'HIGH':directionalRisk>0.55?'MEDIUM':'LOW';
  return {action:a,confidence,expectedEdge,riskLevel,hardBlock,alignedWithDqn:dqnAlign===1,vetoCount:vetoes.length,changes:[]};
}
function compare(ctx={}){
 const actions=['BUY','SELL','MONITOR','BLOCK'];
 const scenarios=actions.map(a=>evaluateScenario(a,ctx));
 const actual=normalizeAction(ctx.actualAction||ctx.router?.recommendation||'MONITOR');
 const recommended=scenarios.filter(x=>!x.hardBlock).sort((a,b)=>b.confidence-a.confidence)[0]||scenarios[2];
 return {mode:'READ_ONLY_COUNTERFACTUAL',timestamp:Date.now(),actualAction:actual,recommendedAction:recommended.action,scenarios,conflicts:scenarios.filter(x=>x.action!==actual&&Math.abs(x.confidence-(scenarios.find(y=>y.action===actual)?.confidence||0))>=10).map(x=>({action:x.action,deltaConfidence:x.confidence-(scenarios.find(y=>y.action===actual)?.confidence||0)})),governance:{executionAllowed:false,liveOrders:false,modelPromotionAllowed:false},note:'Counterfactuals are scenario estimates from current telemetry; they do not imply causality or future performance.'};
}
module.exports={compare,evaluateScenario};
