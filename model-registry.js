'use strict';
const fs=require('fs');const path=require('path');const crypto=require('crypto');

class ModelRegistry {
  constructor({dir='./models/registry',logger=console}={}) {
    this.dir=dir; this.logger=logger; fs.mkdirSync(dir,{recursive:true}); this.file=path.join(dir,'registry.json');
  }
  _read(){ try{return JSON.parse(fs.readFileSync(this.file,'utf8'));}catch{return {models:[],production:null,history:[]};} }
  _write(r){
    const tmp=`${this.file}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp,JSON.stringify(r,null,2)); fs.renameSync(tmp,this.file);
  }
  register(meta){
    if(!meta?.modelId) throw new Error('MODEL_ID_REQUIRED');
    const r=this._read();
    r.models=r.models.filter(m=>m.modelId!==meta.modelId);
    const record={...meta,status:meta.status||'candidate',registeredAt:new Date().toISOString()};
    r.models.push(record);
    if(record.status==='production') r.production=record.modelId;
    this._write(r); return record;
  }
  get(modelId){ return this._read().models.find(m=>m.modelId===modelId)||null; }
  list(){ return this._read().models; }
  production(){ const r=this._read(); return r.models.find(m=>m.modelId===r.production) || null; }
  promote(modelId, evidence={}) {
    const r=this._read(); const candidate=r.models.find(m=>m.modelId===modelId);
    if(!candidate) throw new Error('MODEL_NOT_FOUND');
    const previous=r.production;
    r.models=r.models.map(m=>m.modelId===modelId?{...m,status:'production',promotedAt:new Date().toISOString(),promotionEvidence:evidence}:({...m,status:m.status==='production'?'retired':m.status}));
    r.production=modelId;
    r.history.push({event:'PROMOTE',modelId,previous,at:new Date().toISOString(),evidence});
    this._write(r); return this.get(modelId);
  }
  rollback(reason='manual') {
    const r=this._read(); const current=r.production;
    const previous=[...r.history].reverse().find(h=>h.event==='PROMOTE'&&h.modelId!==current)?.modelId;
    if(!previous) throw new Error('NO_ROLLBACK_TARGET');
    r.models=r.models.map(m=>m.modelId===previous?{...m,status:'production',rolledBackAt:new Date().toISOString()}:{...m,status:m.modelId===current?'rolled-back':m.status});
    r.production=previous; r.history.push({event:'ROLLBACK',from:current,to:previous,reason,at:new Date().toISOString()}); this._write(r); return this.get(previous);
  }
  fingerprint(meta){ return crypto.createHash('sha256').update(JSON.stringify(meta||{})).digest('hex'); }
}
module.exports={ModelRegistry};
