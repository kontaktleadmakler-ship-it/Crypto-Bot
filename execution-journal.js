'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * B13 append-only event journal.
 * Each record contains a monotonic sequence and hash-chain link.
 * The journal is deliberately filesystem based: no broker/exchange calls.
 */
class ExecutionJournal {
  constructor({dir='./data/execution-journal', clock=()=>Date.now()}={}) {
    this.dir = dir;
    this.clock = clock;
    fs.mkdirSync(dir,{recursive:true});
  }
  _file(ts) {
    return path.join(this.dir, new Date(ts).toISOString().slice(0,10)+'.jsonl');
  }
  _last(file) {
    if (!fs.existsSync(file)) return null;
    const lines=fs.readFileSync(file,'utf8').trim().split('\n').filter(Boolean);
    return lines.length ? JSON.parse(lines[lines.length-1]) : null;
  }
  append(event) {
    const ts = Number(event.ts || this.clock());
    const file = this._file(ts);
    const prev = this._last(file);
    const seq = prev ? Number(prev.seq)+1 : 1;
    const base = {...event, ts, seq};
    const prevHash = prev ? prev.hash : 'GENESIS';
    const hash = crypto.createHash('sha256')
      .update(prevHash+'|'+JSON.stringify(base)).digest('hex');
    const record = {...base, prevHash, hash};
    fs.appendFileSync(file, JSON.stringify(record)+'\n',{encoding:'utf8'});
    return record;
  }
  read(day) {
    const file=path.join(this.dir,`${day}.jsonl`);
    if(!fs.existsSync(file)) return [];
    return fs.readFileSync(file,'utf8').split('\n').filter(Boolean).map(JSON.parse);
  }
  verify(day) {
    const events=this.read(day);
    let prev='GENESIS', expectedSeq=1;
    for(const e of events){
      if(e.seq!==expectedSeq || e.prevHash!==prev) return {ok:false,reason:'CHAIN_MISMATCH',seq:e.seq};
      const withoutHash={...e}; delete withoutHash.hash; delete withoutHash.prevHash;
      const calc=crypto.createHash('sha256').update((e.prevHash||'GENESIS')+'|'+JSON.stringify(withoutHash)).digest('hex');
      if(calc!==e.hash) return {ok:false,reason:'HASH_MISMATCH',seq:e.seq};
      prev=e.hash; expectedSeq++;
    }
    return {ok:true,count:events.length,lastHash:prev};
  }
}
module.exports=ExecutionJournal;
