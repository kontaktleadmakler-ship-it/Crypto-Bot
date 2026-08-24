'use strict';
const fs=require('fs');const s=fs.readFileSync(require('path').join(__dirname,'..','rl-engine.js'),'utf8');
if(s.indexOf('const meanAdv = meanLayer.apply(advOut);')===-1) throw new Error('meanLayer must be applied before setWeights');
if(s.indexOf('const meanRep = meanRepLayer.apply(meanAdv);')===-1) throw new Error('meanRepLayer must be applied before setWeights');
if(s.indexOf('const valueRep = valueRepLayer.apply(valueOut);')===-1) throw new Error('valueRepLayer must be applied before setWeights');
const a=s.indexOf('const meanAdv = meanLayer.apply(advOut);'), b=s.indexOf('meanLayer.setWeights([meanKernel]);'); if(!(a<b)) throw new Error('meanLayer order invalid');
const c=s.indexOf('const meanRep = meanRepLayer.apply(meanAdv);'), d=s.indexOf('meanRepLayer.setWeights([onesKernel]);'); if(!(c<d)) throw new Error('meanRepLayer order invalid');
const e=s.indexOf('const valueRep = valueRepLayer.apply(valueOut);'), f=s.indexOf('valueRepLayer.setWeights([valueKernel]);'); if(!(e<f)) throw new Error('valueRepLayer order invalid');
console.log('DQN hotfix source test: OK');
