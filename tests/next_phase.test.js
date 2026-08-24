'use strict';
const assert = require('assert');
const { DataRecovery } = require('../data-recovery');
const { classifyCVD, evaluateMicrostructure } = require('../market-microstructure');
const { ModelRegistry } = require('../model-registry');
const { ModelDriftMonitor } = require('../model-drift-monitor');
const fs = require('fs');
const os = require('os');
const path = require('path');

(async () => {
  let calls = 0;
  const recovery = new DataRecovery({ fetcher: async (_s,_t,limit) => { calls++; return calls < 2 ? [] : Array.from({length: limit}, (_,i)=>({time:i,open:1,high:1,low:1,close:1,volume:1})); }, retries: 3, limits:[20,40] });
  const r = await recovery.get('BTC-USDT','15m',20);
  assert.strictEqual(r.recovered, true);
  assert.strictEqual(r.rows.length, 40);

  const cvd = classifyCVD([{side:'buy',size:5},{side:'sell',size:2}]);
  assert.strictEqual(cvd.delta, 3);
  assert(evaluateMicrostructure({orderBook:{spreadPct:0.01,bidAskRatio:1.2},trades:[{side:'buy',size:5}],direction:'LONG'}).score > 50);
  assert.strictEqual(evaluateMicrostructure({orderBook:{spreadPct:1,bidAskRatio:1},direction:'LONG',spreadLimitPct:0.15}).veto, true);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'model-reg-'));
  const registry = new ModelRegistry({dir});
  registry.register({modelId:'test-1',modelType:'tfjs',status:'candidate'});
  registry.promote('test-1');
  assert.strictEqual(registry.production().modelId,'test-1');
  fs.rmSync(dir,{recursive:true,force:true});

  const drift = new ModelDriftMonitor({windowSize:40,threshold:0.2});
  for(let i=0;i<30;i++) drift.observe({x:1});
  assert(drift.baseline);
  for(let i=0;i<30;i++) drift.observe({x:10});
  assert(drift.status().drift);
  console.log('Next-phase hardening tests passed');
})().catch(e=>{console.error(e);process.exit(1);});
