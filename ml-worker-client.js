'use strict';
const path = require('path');
const { Worker } = require('worker_threads');
class MLWorkerClient {
  constructor({ modelDir = './models/signal-model', timeoutMs = 2000, logger = console } = {}) {
    this.modelDir = path.resolve(modelDir); this.timeoutMs = timeoutMs; this.logger = logger; this.worker = null; this.seq = 0; this.pending = new Map(); this.ready = false;
  }
  async start(){
    if (this.worker) return this.ready;
    this.worker = new Worker(path.join(__dirname,'ml-worker.js'), { workerData:{ modelDir:this.modelDir } });
    this.worker.on('message', m => { if(m.type==='ready'){this.ready=!!m.loaded; return;} const p=this.pending.get(m.id); if(!p)return; this.pending.delete(m.id); clearTimeout(p.timer); m.error?p.reject(new Error(m.error)):p.resolve(m.result); });
    this.worker.on('error', e => { this.ready=false; for(const p of this.pending.values()) { clearTimeout(p.timer); p.reject(e); } this.pending.clear(); });
    await new Promise(r => setTimeout(r, 20));
    return this.ready;
  }
  async predict(features){
    if(!this.worker) await this.start();
    if(!this.worker || !this.ready) return { probability:.5, class:'UNKNOWN', confidence:0, trained:false, workerAvailable:false };
    return this.request({type:'predict',features});
  }
  request(msg){ return new Promise((resolve,reject)=>{const id=++this.seq; const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('ML_WORKER_TIMEOUT'));},this.timeoutMs); this.pending.set(id,{resolve,reject,timer}); this.worker.postMessage({...msg,id});}); }
  async stop(){ if(!this.worker)return; this.worker.postMessage({type:'shutdown'}); await this.worker.terminate(); this.worker=null; this.ready=false; }
}
module.exports={MLWorkerClient};
