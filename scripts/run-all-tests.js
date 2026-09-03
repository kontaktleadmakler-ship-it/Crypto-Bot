'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const testsRoot = path.join(root, 'tests');

function collectTests(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectTests(full));
    else if (entry.isFile() && entry.name.endsWith('.test.js')) out.push(full);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

const files = collectTests(testsRoot);
let failed = 0;
for (const file of files) {
  console.log(`
=== ${path.relative(root, file)} ===`);
  const r = spawnSync(process.execPath, [file], {
    stdio: 'inherit',
    env: { ...process.env, TERM: 'dumb' }
  });
  if (r.status !== 0) {
    failed++;
    console.error(`FAILED: ${path.relative(root, file)}`);
  }
}
if (failed) {
  console.error(`
${failed} test file(s) failed.`);
  process.exit(1);
}
console.log(`
All ${files.length} test files passed.`);
