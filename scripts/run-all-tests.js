'use strict';
const fs=require('fs');
const path=require('path');
const {spawnSync}=require('child_process');
const dir=path.join(__dirname,'..','tests');
const files=fs.readdirSync(dir).filter(f=>f.endsWith('.test.js')).sort();
let failed=0;
for(const file of files){
  console.log(`\n=== ${file} ===`);
  const r=spawnSync(process.execPath,[path.join(dir,file)],{stdio:'inherit',env:{...process.env,TERM:'dumb'}});
  if(r.status!==0){failed++; console.error(`FAILED: ${file}`);}
}
if(failed){console.error(`\n${failed} test file(s) failed.`);process.exit(1);}
console.log(`\nAll ${files.length} test files passed.`);
