'use strict';
const fs=require('fs');
const path=require('path');
const checks={
  nodeVersion: Number(process.versions.node.split('.')[0]) >= 22,
  apiKeyConfigured: Boolean(process.env.API_KEY),
  paperExecution: process.env.PAPER_EXECUTION_ENABLED !== 'false',
  liveTradingExplicitlyDisabled: process.env.LIVE_TRADING_ENABLED !== 'true',
  backtestApiDisabledByDefault: process.env.BACKTEST_API_ENABLED !== 'true',
  auditDirectoryWritable: (()=>{try{const d=path.dirname(process.env.AUDIT_TRAIL_FILE||'./data/audit/audit.jsonl');fs.mkdirSync(d,{recursive:true});fs.accessSync(d,fs.constants.W_OK);return true;}catch{return false;}})(),
  registryConfigured: Boolean(process.env.MODEL_REGISTRY_DIR || process.env.DQN_REGISTRY_DIR),
  independentOosEvidence: process.env.PRODUCTION_OOS_EVIDENCE === 'true',
  shadowValidated: process.env.SHADOW_VALIDATED === 'true',
  reconciliationDrillPassed: process.env.RECON_DRILL_PASSED === 'true',
  securityReviewApproved: process.env.SECURITY_REVIEW_APPROVED === 'true',
  humanApproval: process.env.HUMAN_APPROVAL === 'true',
};
const failed=Object.entries(checks).filter(([,v])=>!v).map(([k])=>k);
console.log(JSON.stringify({ready:failed.length===0,checks,failed,mode:failed.length?'PAPER_SHADOW_ONLY':'PRODUCTION_ELIGIBLE'},null,2));
process.exit(failed.length?1:0);
