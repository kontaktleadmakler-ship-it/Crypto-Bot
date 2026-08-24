'use strict';
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');

class StateCheckpointManager {
  constructor({file='./data/checkpoints/latest.json',dir=null}={}) {
    this.file=file;
    this.dir=dir || path.dirname(file);
    fs.mkdirSync(this.dir,{recursive:true});
  }
  _canonical(state){ return JSON.stringify(state); }
  _checksum(state){ return crypto.createHash('sha256').update(this._canonical(state)).digest('hex'); }
  save(state,{sequence=0,eventHash=null,version=1}={}) {
    const snapshot={version,sequence,eventHash,savedAt:Date.now(),state};
    snapshot.checksum=this._checksum(state);
    fs.writeFileSync(this.file,JSON.stringify(snapshot,null,2));
    return snapshot;
  }
  saveVersioned(state,version,{sequence=0,eventHash=null}={}) {
    const file=path.join(this.dir,`snapshot-${String(version).padStart(8,'0')}.json`);
    const snapshot=this.save(state,{sequence,eventHash,version});
    fs.writeFileSync(file,JSON.stringify(snapshot,null,2));
    return file;
  }
  load() {
    if(!fs.existsSync(this.file)) return null;
    const obj=JSON.parse(fs.readFileSync(this.file,'utf8'));
    return this._checksum(obj.state)===obj.checksum ? obj : null;
  }
  verify(snapshot) {
    return !!snapshot && this._checksum(snapshot.state)===snapshot.checksum;
  }
}
module.exports=StateCheckpointManager;
