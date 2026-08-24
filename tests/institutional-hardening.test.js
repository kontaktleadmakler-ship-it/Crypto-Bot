'use strict';
const assert=require('assert');
const {ExecutionSimulator}=require('../execution-simulator');
const {resolveIntrabar}=require('../institutional-core/intrabar-execution');
const {WalkForwardEngine}=require('../walk-forward-engine');
const {ModelRegistry}=require('../model-registry');
const {SafetyController}=require('../institutional-core/safety-controller');
const {ProductionReadinessGate}=require('../institutional-core/readiness-gate');
const {PortfolioLedger}=require('../institutional-core/portfolio-ledger');
const {LiveExecutionGate}=require('../institutional-core/live-execution-gate');
const fs=require('fs');
const os=require('os');
const path=require('path');

const sim=new ExecutionSimulator({config:{PAPER_TAKER_FEE_PERCENT:0.1,PAPER_FILL_RATIO:0.5,PAPER_SLIPPAGE_PERCENT:0}});
const fill=sim.simulateMarketOrder({direction:'LONG',referencePrice:100,quantity:10});
assert.strictEqual(fill.quantity,5);
assert(Math.abs(fill.feeUSD-(fill.notionalUSD*0.001))<1e-12,'fee must be charged on filled notional');

assert.deepStrictEqual(resolveIntrabar({direction:'LONG',high:110,low:90,stopLoss:95,tp1:103,tp2:108}),{event:'STOP',price:95});
assert.deepStrictEqual(resolveIntrabar({direction:'SHORT',high:110,low:90,stopLoss:105,tp1:97,tp2:92}),{event:'STOP',price:105});

const wf=new WalkForwardEngine({trainBars:10,testBars:5,stepBars:5});
assert.strictEqual(wf.windows(25).length,3);

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'registry-'));
const reg=new ModelRegistry({dir});
reg.register({modelId:'a',status:'candidate'}); reg.register({modelId:'b',status:'candidate'}); reg.promote('a',{oos:0.61}); assert.strictEqual(reg.production().modelId,'a'); reg.promote('b',{oos:0.62}); assert.strictEqual(reg.production().modelId,'b'); assert.strictEqual(reg.rollback().modelId,'a');

const safety=new SafetyController(); assert.strictEqual(safety.isTradingAllowed(),true); safety.set('kill-switch',true,'test'); assert.strictEqual(safety.isTradingAllowed(),false);
const gate=new ProductionReadinessGate({required:['api','recon']}); assert.strictEqual(gate.evaluate({api:true,recon:false}).ready,false); assert.strictEqual(gate.evaluate({api:true,recon:true}).ready,true);
const live=new LiveExecutionGate({enabled:true,readinessProvider:()=>({ready:false,failed:['oos']})}); assert.throws(()=>live.assertAllowed(),/LIVE_EXECUTION_BLOCKED/);
const ledger=new PortfolioLedger(); ledger.append({eventId:'1',realizedPnLUSD:10,feeUSD:1}); ledger.append({eventId:'1',realizedPnLUSD:10}); assert.strictEqual(ledger.snapshot().netPnLUSD,9);
console.log('Institutional hardening tests: OK');
