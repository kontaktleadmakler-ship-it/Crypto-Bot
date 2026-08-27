'use strict';

/**
 * Reproducible KuCoin Futures OHLCV downloader for offline backtests.
 * Signal/Paper only: this script reads public market data and never places orders.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUTPUT_ROOT = path.join(ROOT, 'data', 'ohlcv');
const GRANULARITY = { '1m': 1, '5m': 5, '15m': 15, '30m': 30, '1h': 60, '2h': 120, '4h': 240, '8h': 480, '12h': 720, '1d': 1440, '1w': 10080 };
const MAX_WINDOW_BARS = 480; // KuCoin futures endpoint practical request window.
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function kucoinSymbol(symbol) {
  const base = String(symbol).toUpperCase().replace(/[-_/]/g, '').replace(/USDT$/, '');
  return base === 'BTC' ? 'XBTUSDTM' : `${base}USDTM`;
}
function parseTime(value, fallback) {
  if (value == null || value === '') return fallback;
  const n = Number(value);
  if (Number.isFinite(n)) return n < 1e12 ? n * 1000 : n;
  const t = Date.parse(value);
  if (!Number.isFinite(t)) throw new Error(`Ungültiger Timestamp: ${value}`);
  return t;
}
function normalizeRow(row) {
  if (!Array.isArray(row) || row.length < 6) return null;
  const [time, open, close, high, low, volume] = row.map(Number);
  if (![time, open, close, high, low, volume].every(Number.isFinite)) return null;
  return { time, open, high, low, close, volume };
}
function validateBars(bars, timeframe) {
  const interval = GRANULARITY[timeframe] * 60 * 1000;
  let duplicates = 0, outOfOrder = 0, invalid = 0, gaps = 0;
  const seen = new Set();
  let previous = null;
  for (const bar of bars) {
    if (!bar || ![bar.time, bar.open, bar.high, bar.low, bar.close, bar.volume].every(Number.isFinite) || bar.high < Math.max(bar.open, bar.close, bar.low) || bar.low > Math.min(bar.open, bar.close, bar.high) || bar.volume < 0) {
      invalid++; continue;
    }
    if (seen.has(bar.time)) duplicates++;
    seen.add(bar.time);
    if (previous != null) {
      if (bar.time <= previous) outOfOrder++;
      else if (bar.time - previous > interval * 1.5) gaps += Math.max(1, Math.round((bar.time - previous) / interval) - 1);
    }
    previous = bar.time;
  }
  return { bars: bars.length, duplicates, outOfOrder, invalid, missingBars: gaps, intervalMs: interval };
}

async function fetchWindow(symbol, timeframe, from, to, retries = 4) {
  const granularity = GRANULARITY[timeframe];
  const url = 'https://api-futures.kucoin.com/api/v1/kline/query';
  let lastError;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const axios = require('axios');
      const response = await axios.get(url, { params: { symbol: kucoinSymbol(symbol), granularity, from, to }, timeout: 20000 });
      return (response.data?.data || []).map(normalizeRow).filter(Boolean);
    } catch (error) {
      lastError = error;
      if (attempt + 1 < retries) await sleep(1000 * (attempt + 1));
    }
  }
  throw new Error(`KuCoin Kline-Abruf fehlgeschlagen: ${lastError?.message || 'unknown error'}`);
}

async function downloadOHLCV({ symbol = 'BTC-USDT', timeframe = '15m', from, to = Date.now(), delayMs = 150, logger = console, shouldContinue = () => true, onProgress = null }) {
  if (!GRANULARITY[timeframe]) throw new Error(`Unsupported timeframe: ${timeframe}`);
  const end = parseTime(to, Date.now());
  const start = parseTime(from, end - 30 * 86400000);
  if (!(start < end)) throw new Error('from muss vor to liegen');
  const intervalMs = GRANULARITY[timeframe] * 60 * 1000;
  const windowMs = intervalMs * MAX_WINDOW_BARS;
  const all = [];
  let cursor = end;
  let requests = 0;
  while (cursor > start) {
    if (!shouldContinue()) {
      const error = new Error('OHLCV download cancelled');
      error.code = 'OHLCV_DOWNLOAD_CANCELLED';
      throw error;
    }
    const windowFrom = Math.max(start, cursor - windowMs);
    const rows = await fetchWindow(symbol, timeframe, windowFrom, cursor);
    requests++;
    all.push(...rows.filter(b => b.time >= start && b.time < end));
    if (!rows.length) break;
    const minTime = Math.min(...rows.map(b => b.time));
    if (!(minTime < cursor)) break;
    cursor = minTime - 1;
    if (delayMs > 0) await sleep(delayMs);
    logger.log?.(`[OHLCV] ${symbol} ${timeframe}: request=${requests}, candles=${all.length}`);
    onProgress?.({ symbol, timeframe, start, end, cursor, requests, candles: all.length, percent: Math.max(0, Math.min(100, ((end - cursor) / (end - start)) * 100)) });
  }
  const map = new Map();
  for (const bar of all) map.set(bar.time, bar);
  const bars = [...map.values()].sort((a, b) => a.time - b.time);
  const quality = validateBars(bars, timeframe);
  return { symbol, timeframe, from: start, to: end, downloadedAt: new Date().toISOString(), bars, quality, requests };
}

function writeDataset(dataset, outputRoot = OUTPUT_ROOT) {
  const dir = path.join(outputRoot, dataset.symbol);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${dataset.timeframe}.json`);
  const payload = {
    schema: 'crypto-bot.ohlcv.v1',
    exchange: 'kucoin-futures',
    symbol: dataset.symbol,
    timeframe: dataset.timeframe,
    from: new Date(dataset.from).toISOString(),
    to: new Date(dataset.to).toISOString(),
    downloadedAt: dataset.downloadedAt,
    quality: dataset.quality,
    bars: dataset.bars
  };
  fs.writeFileSync(file, JSON.stringify(payload, null, 2));
  return file;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    args[key] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const symbol = args.symbol || 'BTC-USDT';
  const timeframe = args.timeframe || '15m';
  const dataset = await downloadOHLCV({ symbol, timeframe, from: args.from, to: args.to, delayMs: Number(args.delayMs ?? 150) });
  const file = writeDataset(dataset, args.output ? path.resolve(args.output) : OUTPUT_ROOT);
  console.log(`\n[OHLCV] Fertig: ${file}`);
  console.log(`[OHLCV] ${JSON.stringify(dataset.quality)}`);
}

if (require.main === module) main().catch(error => { console.error(`❌ ${error.stack || error.message}`); process.exitCode = 1; });

module.exports = { GRANULARITY, kucoinSymbol, normalizeRow, validateBars, fetchWindow, downloadOHLCV, writeDataset, parseArgs };
