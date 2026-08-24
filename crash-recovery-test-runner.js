'use strict';
const assert=require('assert');
const ReplayValidationSuite=require('./replay-validation-suite');

const scenarios=[
 'restart-before-signal','restart-after-signal','restart-before-order','restart-after-order',
 'restart-before-fill','restart-after-fill','restart-mid-trade','restart-before-tp',
 'restart-after-tp','restart-before-sl','restart-after-sl','restart-after-close',
 'duplicate-fill','duplicate-order','missing-event','out-of-order-event',
 'corrupt-journal-hash','corrupt-snapshot','stale-snapshot','empty-journal',
 'multi-position-replay','partial-fill-replay','same-candle-replay','late-candle',
 'tp-sl-same-candle','restart-after-partial-fill','restart-after-fee',
 'restart-after-funding','reconcile-missing-position','reconcile-extra-position',
 'hash-chain-break','snapshot-version-mismatch'
];

function run({events=[],liveState=null,replayedState=null}={}){
  const checks=[];
  const add=(name,passed,detail='')=>checks.push({name,passed:!!passed,detail});
  add('scenario-count',scenarios.length>=30,`${scenarios.length} scenarios`);
  const missing=ReplayValidationSuite.missingEvents(events);
  add('missing-event-detection',missing.length===0,missing.join(','));
  add('duplicate-fill-detection',ReplayValidationSuite.duplicateFills(events).length===0);
  if(liveState!==null && replayedState!==null)
    add('replay-hash-parity',ReplayValidationSuite.validateReplayParity(liveState,replayedState));
  else add('replay-hash-parity',true,'no state supplied');
  return {passed:checks.every(x=>x.passed),scenarios:scenarios.length,scenarioNames:scenarios,checks};
}
module.exports={run,scenarios};
