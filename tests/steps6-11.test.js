'use strict';
const assert=require('assert');
const {OrderFlowAnalyzer}=require('../orderFlowAnalyzer');
const {ModelGovernance}=require('../model-governance');
const {ChaosSuite}=require('../chaos-suite');
const {PaperValidation}=require('../paper-validation');
const {ShadowGovernor}=require('../shadow-governor');
const {ControlledScalingGate}=require('../controlled-scaling-gate');
(async()=>{
 const of=new OrderFlowAnalyzer(); const r=of.evaluateOrderFlow([], {bids:[[100,10],[99,2],[98,2]],asks:[[101,2],[102,2],[103,2]]}, [{side:'BUY',qty:10},{side:'SELL',qty:1}]); assert(r.valid&&r.isTrueCVD); const wall=of.evaluateOrderFlow([], {bids:[[100,1000],[99,2],[98,2]],asks:[[101,2],[102,2],[103,2]]}, []); assert(wall.wallDetected&&wall.wallOnlySignalBlocked);
 const mg=new ModelGovernance({minOos:.55}); mg.register({modelVersion:'v1',validationAccuracy:.7,validationBalancedAccuracy:.65}); assert(mg.validateForProduction(mg.active)); assert(mg.evaluateDrift({score:.5}).halted); mg.register({modelVersion:'v2',validationAccuracy:.8,validationBalancedAccuracy:.8}); assert(mg.rollback().modelVersion==='v1');
 const chaos=new ChaosSuite({executor:async()=>{}}); assert((await chaos.run()).passed);
 const pv=new PaperValidation(); pv.record({signalDecisionLatencyMs:10,reconciliationCorrect:true}); assert(pv.summary().reconciliationRate===1);
 const sg=new ShadowGovernor(); assert(sg.evaluate({expectedPosition:{BTC:1},actualPosition:{BTC:0}}).allowedToSubmit===false);
 const gate=new ControlledScalingGate({liveEnabled:false,maxLiveNotional:10}); assert(!gate.evaluate({stage:'TINY_LIVE',paperPassed:true,shadowPassed:true,chaosPassed:true,readiness:true,killSwitch:true,notional:1}).allowed);
 console.log('steps6-11: PASS');
})().catch(e=>{console.error(e);process.exit(1);});
