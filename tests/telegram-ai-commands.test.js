'use strict';
const fs=require('fs');
const src=fs.readFileSync('trading-bot-v24.6-runtime.js','utf8');
const pkg=require('../package.json');
const required=["commands", "aicommands", "agents", "agents_status", "agent", "agent_on", "agent_off", "agents_on", "agents_off", "agent_weights", "llm_status", "llm_on", "llm_off", "llm_test", "signals", "top_signals", "signal", "explain", "confluence", "anomalies", "regime", "risk", "ai_hardening", "ai_architecture", "drift", "model_drift", "agent_attribution", "agent_stats", "kill_status", "retrain"];
for(const c of required){ if(!src.includes("command === '/"+c+"'") && !src.includes("command === '/"+c+"' ||")) throw new Error('missing handler: /'+c); }
if(!src.includes('setMyCommands')) throw new Error('Telegram setMyCommands registration missing');
if(!src.includes('await registerTelegramCommands();')) throw new Error('Telegram command registration not called at startup');
if(pkg.engines.node!=='22.x') throw new Error('Node must be pinned to 22.x for tfjs-node compatibility');
if(pkg.dependencies['@tensorflow/tfjs-node']!=='4.22.0') throw new Error('tfjs-node must be pinned to 4.22.0');
console.log('telegram AI command + TFJS runtime checks passed');
