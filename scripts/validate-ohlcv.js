'use strict';
const fs = require('fs');
const path = require('path');
const { GRANULARITY, validateBars } = require('./download-ohlcv');

function loadDataset(file) {
  const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
  const bars = Array.isArray(payload) ? payload : payload.bars;
  if (!Array.isArray(bars)) throw new Error(`Kein bars-Array in ${file}`);
  return { payload, bars };
}
function main() {
  const file = process.argv[2];
  if (!file) throw new Error('Usage: node scripts/validate-ohlcv.js <dataset.json>');
  const { payload, bars } = loadDataset(path.resolve(file));
  const timeframe = payload.timeframe || '15m';
  if (!GRANULARITY[timeframe]) throw new Error(`Unbekanntes timeframe: ${timeframe}`);
  const quality = validateBars(bars, timeframe);
  console.log(JSON.stringify({ file: path.resolve(file), symbol: payload.symbol || 'unknown', timeframe, quality }, null, 2));
  if (quality.invalid || quality.duplicates || quality.outOfOrder) process.exitCode = 2;
}
if (require.main === module) { try { main(); } catch (e) { console.error(`❌ ${e.message}`); process.exitCode = 1; } }
module.exports = { loadDataset };
