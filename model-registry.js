'use strict';
const fs=require('fs');const path=require('path');
class ModelRegistry{constructor({dir='./models/registry',logger=console}={}){this.dir=dir;this.logger=logger;fs.mkdirSync(dir,{recursive:true});this.file=path.join(dir,'registry.json');} _read(){try{return JSON.parse(fs.readFileSync(this.file,'utf8'));}catch{return {models:[],production:null};}} register(meta){const r=this._read();r.models=r.models.filter(m=>m.modelId!==meta.modelId);r.models.push({...meta,registeredAt:new Date().toISOString()});if(meta.status==='production')r.production=meta.modelId;fs.writeFileSync(this.file,JSON.stringify(r,null,2));return meta;} production(){return this._read().production;} }
module.exports={ModelRegistry};
